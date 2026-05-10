use crate::key_utils;
use serde_json::Value;
use sha2::{Digest, Sha512};
use hmac::{Hmac, Mac};
use pbkdf2::pbkdf2_hmac;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::result::Result as StdResult;

type HmacSha512 = Hmac<Sha512>;

const PAGE_SZ: u64 = 4096;
const KEY_SZ: usize = 32;
const SALT_SZ: usize = 16;

/// 通过 HMAC-SHA512 校验 page 1 验证 enc_key 是否正确
fn verify_enc_key(enc_key: &[u8], db_page1: &[u8]) -> bool {
    let salt = &db_page1[..SALT_SZ];
    let mac_salt: Vec<u8> = salt.iter().map(|b| b ^ 0x3A).collect();

    let mut mac_key = vec![0u8; KEY_SZ];
    pbkdf2_hmac::<Sha512>(enc_key, &mac_salt, 2, &mut mac_key);

    let hmac_data = &db_page1[SALT_SZ..(PAGE_SZ as usize - 80 + 16)];
    let stored_hmac = &db_page1[(PAGE_SZ as usize - 64)..(PAGE_SZ as usize)];

    let mut mac = HmacSha512::new_from_slice(&mac_key).expect("HMAC 初始化失败");
    mac.update(hmac_data);
    mac.update(&1u32.to_le_bytes());

    mac.verify_slice(stored_hmac).is_ok()
}

/// 收集目录下的 DB 文件信息
#[derive(Debug, Clone)]
pub struct DbFileInfo {
    pub rel_path: String,
    pub abs_path: String,
    pub size: u64,
    pub salt_hex: String,
    pub page1: Vec<u8>,
}

pub struct SaltToDbs {
    pub map: HashMap<String, Vec<String>>,
}

/// 遍历 db_dir 收集所有 .db 文件及其 salt
pub fn collect_db_files(db_dir: &Path) -> Result<(Vec<DbFileInfo>, SaltToDbs), String> {
    let mut db_files = Vec::new();
    let mut salt_to_dbs = HashMap::new();

    for entry in walkdir::WalkDir::new(db_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if !name.ends_with(".db") || name.ends_with("-wal") || name.ends_with("-shm") {
            continue;
        }

        let size = std::fs::metadata(path)
            .map_err(|e| format!("获取文件大小失败: {}", e))?
            .len();
        if size < PAGE_SZ {
            continue;
        }

        let page1 = std::fs::read(path)
            .map_err(|e| format!("读取文件失败: {}", e))?;
        let page1_trimmed: Vec<u8> = page1.iter().copied().take(PAGE_SZ as usize).collect();
        let salt = &page1_trimmed[..SALT_SZ];
        let salt_hex = hex::encode(salt);

        let rel_path = path.strip_prefix(db_dir)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.to_string());

        db_files.push(DbFileInfo {
            rel_path: rel_path.clone(),
            abs_path: path.to_string_lossy().to_string(),
            size,
            salt_hex: salt_hex.clone(),
            page1: page1_trimmed,
        });
        salt_to_dbs.entry(salt_hex.clone()).or_insert_with(Vec::new).push(rel_path);
    }

    Ok((db_files, SaltToDbs { map: salt_to_dbs }))
}

/// 扫描内存数据匹配 hex 模式并验证密钥
pub fn scan_memory_for_keys(
    data: &[u8],
    db_files: &[DbFileInfo],
    salt_to_dbs: &SaltToDbs,
    key_map: &mut HashMap<String, String>,
    remaining_salts: &mut HashSet<String>,
) -> usize {
    let mut matches = 0;
    let data_str = String::from_utf8_lossy(data);

    // 匹配连续的十六进制字符串
    let hex_re = regex::Regex::new(r"([0-9a-fA-F]{64,})").unwrap();

    for cap in hex_re.captures_iter(&data_str) {
        let hex_str = cap[1].to_string();
        let hex_len = hex_str.len();

        if hex_len == 96 {
            let enc_key_hex = &hex_str[..64];
            let salt_hex = &hex_str[64..];
            if remaining_salts.contains(salt_hex) {
                if let Ok(enc_key) = hex::decode(enc_key_hex) {
                    for info in db_files {
                        if info.salt_hex == *salt_hex && verify_enc_key(&enc_key, &info.page1) {
                            key_map.insert(salt_hex.to_string(), enc_key_hex.to_string());
                            remaining_salts.remove(salt_hex);
                            matches += 1;
                            break;
                        }
                    }
                }
            }
        } else if hex_len == 64 {
            if remaining_salts.is_empty() {
                continue;
            }
            if let Ok(enc_key) = hex::decode(&hex_str) {
                for info in db_files {
                    if remaining_salts.contains(&info.salt_hex) && verify_enc_key(&enc_key, &info.page1) {
                        key_map.insert(info.salt_hex.clone(), hex_str.clone());
                        remaining_salts.remove(&info.salt_hex);
                        matches += 1;
                        break;
                    }
                }
            }
        } else if hex_len > 96 && hex_len % 2 == 0 {
            let enc_key_hex = &hex_str[..64];
            let salt_hex = &hex_str[hex_len - 32..];
            if remaining_salts.contains(salt_hex) {
                if let Ok(enc_key) = hex::decode(enc_key_hex) {
                    for info in db_files {
                        if info.salt_hex == *salt_hex && verify_enc_key(&enc_key, &info.page1) {
                            key_map.insert(salt_hex.to_string(), enc_key_hex.to_string());
                            remaining_salts.remove(salt_hex);
                            matches += 1;
                            break;
                        }
                    }
                }
            }
        }
    }

    matches
}

/// 用已找到的 key 交叉验证未匹配的 salt
pub fn cross_verify_keys(
    db_files: &[DbFileInfo],
    salt_to_dbs: &SaltToDbs,
    key_map: &mut HashMap<String, String>,
) {
    let missing_salts: HashSet<String> = salt_to_dbs.map.keys()
        .filter(|s| !key_map.contains_key(*s))
        .cloned()
        .collect();

    if missing_salts.is_empty() || key_map.is_empty() {
        return;
    }

    eprintln!("还有 {} 个 salt 未匹配，尝试交叉验证...", missing_salts.len());

    for salt_hex in &missing_salts {
        for info in db_files {
            if info.salt_hex == *salt_hex {
                for (_known_salt, known_key_hex) in key_map.iter() {
                    if let Ok(enc_key) = hex::decode(known_key_hex) {
                        if verify_enc_key(&enc_key, &info.page1) {
                            key_map.insert(salt_hex.clone(), known_key_hex.clone());
                            eprintln!("  [CROSS] salt={} 可用 key", salt_hex);
                            break;
                        }
                    }
                }
                break;
            }
        }
    }
}

/// 保存密钥结果到 JSON 文件
pub fn save_results(
    db_files: &[DbFileInfo],
    salt_to_dbs: &SaltToDbs,
    key_map: &HashMap<String, String>,
    output_path: &Path,
) -> Result<HashMap<String, String>, String> {
    eprintln!("\n{}", "=".repeat(60));
    eprintln!("结果: {}/{} salts 找到密钥", key_map.len(), salt_to_dbs.map.len());

    let mut result = serde_json::Map::new();
    for info in db_files {
        if let Some(enc_key) = key_map.get(&info.salt_hex) {
            let entry = serde_json::json!({
                "enc_key": enc_key,
                "salt": info.salt_hex,
                "size_mb": format!("{:.1}", info.size as f64 / 1024.0 / 1024.0),
            });
            result.insert(info.rel_path.clone(), entry);
            eprintln!("  OK: {} ({:.1}MB)", info.rel_path, info.size as f64 / 1024.0 / 1024.0);
        } else {
            eprintln!("  MISSING: {} (salt={})", info.rel_path, info.salt_hex);
        }
    }

    if result.is_empty() {
        return Err("未能从任何微信进程中提取到密钥".to_string());
    }

    let json = serde_json::Value::Object(result);
    let content = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(output_path, content)
        .map_err(|e| format!("写入密钥文件失败: {}", e))?;

    eprintln!("\n密钥保存到: {}", output_path.display());

    let mut missing = Vec::new();
    for info in db_files {
        if !key_map.contains_key(&info.salt_hex) {
            missing.push(info.rel_path.clone());
        }
    }
    if !missing.is_empty() {
        eprintln!("\n未找到密钥的数据库:");
        for m in &missing {
            eprintln!("  {}", m);
        }
    }

    Ok(key_map.clone())
}

// ===== macOS 密钥提取 (C 二进制) =====

#[cfg(target_os = "macos")]
pub fn extract_keys_macos(db_dir: &Path, output_path: &Path) -> Result<HashMap<String, String>, String> {
    use std::process::Command;

    // 查找对应架构的二进制
    let machine = std::env::consts::ARCH;
    let bin_name = format!("find_all_keys_macos.{}", if machine == "aarch64" { "arm64" } else { "x86_64" });

    // 查找二进制路径（相对于 src-cli 或项目根）
    let bin_path = find_binary(&bin_name)?;

    let work_dir = db_dir.parent()
        .ok_or_else(|| "无法获取 db_storage 父目录".to_string())?;

    eprintln!("[+] 使用 C 二进制提取密钥: {}", bin_path.display());
    eprintln!("[+] 工作目录: {}", work_dir.display());

    let result = Command::new(&bin_path)
        .current_dir(work_dir)
        .output()
        .map_err(|e| format!("执行密钥提取二进制失败: {}", e))?;

    if !result.stdout.is_empty() {
        print!("{}", String::from_utf8_lossy(&result.stdout));
    }
    if !result.stderr.is_empty() {
        eprint!("{}", String::from_utf8_lossy(&result.stderr));
    }

    // 检查 task_for_pid 失败
    let combined = String::from_utf8_lossy(&result.stdout).to_string()
        + &String::from_utf8_lossy(&result.stderr);

    if combined.contains("task_for_pid") {
        eprintln!("\n[!] task_for_pid 失败：macOS 安全策略阻止了进程内存访问。");
        eprintln!("需要对微信重新签名以允许调试访问。");
        return Err("task_for_pid 失败，请对微信重新签名后重试".to_string());
    }

    // C 二进制输出 all_keys.json 到工作目录
    let c_output = work_dir.join("all_keys.json");
    if !c_output.exists() {
        return Err("C 二进制未能生成密钥文件".to_string());
    }

    let content = std::fs::read_to_string(&c_output)
        .map_err(|e| format!("读取密钥文件失败: {}", e))?;
    let keys_data: Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析密钥文件失败: {}", e))?;

    // 保存到目标路径
    std::fs::write(output_path, &content)
        .map_err(|e| format!("写入密钥文件失败: {}", e))?;

    // 清理临时文件
    if c_output.canonicalize().ok().as_deref() != Some(output_path) {
        std::fs::remove_file(&c_output).ok();
    }

    // 构建 salt -> key 映射
    let mut key_map = HashMap::new();
    if let Some(obj) = keys_data.as_object() {
        for (_rel, info) in obj {
            if let Some(info_obj) = info.as_object() {
                if let (Some(enc_key), Some(salt)) = (
                    info_obj.get("enc_key").and_then(|v| v.as_str()),
                    info_obj.get("salt").and_then(|v| v.as_str()),
                ) {
                    key_map.insert(salt.to_string(), enc_key.to_string());
                }
            }
        }
    }

    eprintln!("\n[+] 提取到 {} 个密钥，保存到: {}", key_map.len(), output_path.display());
    Ok(key_map)
}

#[cfg(not(target_os = "macos"))]
pub fn extract_keys_macos(_db_dir: &Path, _output_path: &Path) -> Result<HashMap<String, String>, String> {
    Err("macOS 密钥提取仅支持 macOS 平台".to_string())
}

#[cfg(target_os = "macos")]
fn find_binary(bin_name: &str) -> Result<std::path::PathBuf, String> {
    let exe_path = std::env::current_exe().ok();
    let mut candidates: Vec<Option<std::path::PathBuf>> = vec![
        // 相对于可执行文件的 bin/ 目录
        exe_path.as_ref()
            .and_then(|p| p.parent().map(|pp| pp.join("bin").join(bin_name))),
        // 相对于可执行文件的 ../../keys_bin/（开发时 target/debug/ 下运行）
        exe_path.as_ref()
            .and_then(|p| p.parent().and_then(|pp| pp.parent())
                .and_then(|pp| pp.parent())
                .map(|pp| pp.join("keys_bin").join(bin_name))),
        // 相对于可执行文件的 ../../../keys_bin/（深度 debug 路径）
        exe_path.as_ref()
            .and_then(|p| p.parent().and_then(|pp| pp.parent())
                .and_then(|pp| pp.parent()).and_then(|pp| pp.parent())
                .map(|pp| pp.join("keys_bin").join(bin_name))),
        // 从 src-cli 目录（项目根目录运行）
        Some(std::path::PathBuf::from("src-cli").join("keys_bin").join(bin_name)),
        // 从当前目录的 keys_bin/
        std::env::current_dir().ok()
            .map(|p| p.join("keys_bin").join(bin_name)),
        // 全局安装
        Some(std::path::PathBuf::from("/usr/local/bin").join(bin_name)),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(format!("找不到密钥提取二进制: {}。请确保编译了 C 源码", bin_name))
}
