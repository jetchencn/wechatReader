use crate::contacts::{display_name_for_username, get_contact_names, resolve_username};
use crate::db_cache::DBCache;
use crate::key_utils::{find_msg_db_keys, get_enc_key_hex, get_key_info};
use chrono::{DateTime, Local, TimeZone};
use md5::{Digest, Md5};
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

// ===== 内部函数导出（供命令模块调用）=====

/// 解包消息内容
pub fn decompress_content_internal(content: &[u8], ct: i64) -> Option<String> {
    decompress_content(content, Some(ct))
}

/// 格式化消息文本（供命令模块调用）
pub fn format_message_text_internal(
    local_id: i64, local_type: i64, content: &str,
    is_group: bool, chat_username: &str, chat_display_name: &str,
    names: &HashMap<String, String>,
    display_name_fn: &dyn Fn(&str) -> String,
    db_dir: Option<&Path>, create_time_ts: i64, resolve_media: bool,
) -> (String, String) {
    format_message_text(local_id, local_type, content, is_group,
        chat_username, chat_display_name, names, display_name_fn,
        db_dir, create_time_ts, resolve_media)
}

/// 加载 Name2Id 映射
pub fn load_name2id_internal(conn: &rusqlite::Connection) -> HashMap<i64, String> {
    load_name2id_maps(conn)
}

/// 检查安全表名
pub fn is_safe_msg_table_name(name: &str) -> bool {
    let re = Regex::new(r"^Msg_[0-9a-f]{32}$").unwrap();
    re.is_match(name)
}

/// 查询消息
pub fn query_messages(
    conn: &rusqlite::Connection,
    table_name: &str,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    _keyword: &str,
    limit: Option<i64>,
    offset: i64,
    msg_type_filter: Option<(u64, Option<u64>)>,
) -> Result<Vec<(i64, i64, i64, i64, Vec<u8>, Option<i64>)>, String> {
    _query_messages(conn, table_name, start_ts, end_ts, _keyword, limit, offset, msg_type_filter)
}

// ===== 消息类型 =====

pub const MSG_TYPE_FILTERS: &[(&str, u64, Option<u64>)] = &[
    ("text", 1, None),
    ("image", 3, None),
    ("voice", 34, None),
    ("video", 43, None),
    ("sticker", 47, None),
    ("location", 48, None),
    ("link", 49, None),
    ("file", 49, Some(6)),
    ("call", 50, None),
    ("system", 10000, None),
];

pub const MSG_TYPE_NAMES: &[&str] = &[
    "text", "image", "voice", "video", "sticker",
    "location", "link", "file", "call", "system",
];

pub fn split_msg_type(t: i64) -> (u64, u64) {
    let t = t as u64;
    if t > 0xFFFFFFFF {
        (t & 0xFFFFFFFF, t >> 32)
    } else {
        (t, 0)
    }
}

pub fn format_msg_type(t: i64) -> String {
    let (base_type, _) = split_msg_type(t);
    match base_type {
        1 => "文本".to_string(),
        3 => "图片".to_string(),
        34 => "语音".to_string(),
        42 => "名片".to_string(),
        43 => "视频".to_string(),
        47 => "表情".to_string(),
        48 => "位置".to_string(),
        49 => "链接/文件".to_string(),
        50 => "通话".to_string(),
        10000 => "系统".to_string(),
        10002 => "撤回".to_string(),
        _ => format!("type={}", t),
    }
}

// ===== 内容解压 =====

fn decompress_content(content: &[u8], ct: Option<i64>) -> Option<String> {
    if let Some(ct_val) = ct {
        if ct_val == 4 {
            let mut decoder = zstd::Decoder::new(content).ok()?;
            let mut result = String::new();
            std::io::Read::read_to_string(&mut decoder, &mut result).ok()?;
            return Some(result);
        }
    }
    String::from_utf8(content.to_vec()).ok()
}

// ===== 内容解析 =====

fn parse_message_content(content: &str, _local_type: i64, _is_group: bool) -> (String, String) {
    if content.is_empty() {
        return (String::new(), String::new());
    }
    if content.contains(":\n") {
        let mut parts = content.splitn(2, ":\n");
        let sender = parts.next().unwrap_or("").to_string();
        let text = parts.next().unwrap_or("").to_string();
        return (sender, text);
    }
    (String::new(), content.to_string())
}

fn collapse_text(text: &str) -> String {
    let re = Regex::new(r"\s+").unwrap();
    re.replace_all(text.trim(), " ").to_string()
}

fn parse_int(value: &str, fallback: u64) -> u64 {
    value.trim().parse::<u64>().unwrap_or(fallback)
}

// ===== 媒体路径解析 =====

/// Extract md5 from image message XML content
fn extract_img_md5(content: &str) -> Option<String> {
    // Pattern: md5="abc123..." or md5='abc123...'
    if let Some(md5_start) = content.find("md5=\"") {
        let after = &content[md5_start + 5..];
        if let Some(end) = after.find('\"') {
            return Some(after[..end].to_string());
        }
    }
    if let Some(md5_start) = content.find("md5='") {
        let after = &content[md5_start + 5..];
        if let Some(end) = after.find('\'') {
            return Some(after[..end].to_string());
        }
    }
    None
}

/// Cache for decrypted hardlink.db path (avoid repeated decryption).
lazy_static::lazy_static! {
    static ref HARDLINK_DB_CACHE: Mutex<Option<String>> = Mutex::new(None);
}

/// Ensure hardlink.db is decrypted and return the temp path.
/// Returns None if decryption fails or key is unavailable.
fn ensure_hardlink_db(db_dir: &Path) -> Option<std::path::PathBuf> {
    // Check if already decrypted in this session
    {
        let cache = HARDLINK_DB_CACHE.lock().unwrap();
        if let Some(ref path) = *cache {
            let pb = std::path::PathBuf::from(path);
            if pb.is_file() {
                return Some(pb);
            }
        }
    }

    let hardlink_db_path = db_dir.join("hardlink").join("hardlink.db");
    if !hardlink_db_path.is_file() {
        return None;
    }

    let keys_path = std::path::PathBuf::from(crate::config::keys_file());
    if !keys_path.exists() {
        return None;
    }
    let keys_content = std::fs::read_to_string(&keys_path).ok()?;
    let keys_raw: Value = serde_json::from_str(&keys_content).ok()?;
    let all_keys = crate::key_utils::strip_key_metadata(&keys_raw);

    let key_info = all_keys.get("hardlink/hardlink.db")?;
    let enc_key_hex = key_info.get("enc_key")?.as_str()?;
    let enc_key = hex::decode(enc_key_hex).ok()?;

    let tmp_dir = std::env::temp_dir().join("wechat_reader_hardlink");
    std::fs::create_dir_all(&tmp_dir).ok();
    let tmp_path = tmp_dir.join("hardlink.db");

    if let Err(_) = crate::crypto::full_decrypt(&hardlink_db_path, &tmp_path, &enc_key) {
        return None;
    }

    // Cache the path
    let mut cache = HARDLINK_DB_CACHE.lock().unwrap();
    *cache = Some(tmp_path.to_string_lossy().to_string());

    Some(tmp_path)
}

/// Try to resolve image file path via hardlink.db
/// In newer WeChat versions, the .dat filename is NOT the md5 from XML,
/// so we need to use the hardlink database to find the correct mapping.
///
/// hardlink.db schema:
/// - image_hardlink_info_v4: md5_hash(INTEGER), md5(TEXT), type(INTEGER), file_name(TEXT), file_size(INTEGER), modify_time(INTEGER), dir1(INTEGER), dir2(INTEGER)
/// - dir2id: rowid → username(TEXT) which stores either attach subdir hash or date prefix
///   dir1 index → attach subdir hash (e.g., "bb4bfb9f62373bd6cb6d0b09521f1edc")
///   dir2 index → date prefix (e.g., "2025-06")
fn resolve_image_via_hardlink(
    db_dir: &Path,
    content: &str,
    _date_prefix: &str,
    attach_dir: &Path,
    _sub_dir_name: &str,
) -> Option<String> {
    let xml_md5 = extract_img_md5(content)?;
    if xml_md5.is_empty() {
        return None;
    }

    let tmp_path = ensure_hardlink_db(db_dir)?;
    let conn = match rusqlite::Connection::open(&tmp_path) {
        Ok(c) => c,
        Err(_) => return None,
    };

    // Build dir2id lookup: rowid → username (which is dir hash or date prefix)
    let mut dir_map: HashMap<i64, String> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT rowid, username FROM dir2id") {
        if let Ok(rows) = stmt.query_map([], |row| {
            let rowid: i64 = row.get(0)?;
            let username: String = row.get(1)?;
            Ok((rowid, username))
        }) {
            for row in rows.flatten() {
                dir_map.insert(row.0, row.1);
            }
        }
    }

    // Query image_hardlink_info_v4 by md5 field (matches XML md5)
    // dir1 and dir2 are INTEGER indexes into dir2id table
    let sql = "SELECT file_name, dir1, dir2 FROM image_hardlink_info_v4 WHERE md5 = ?";
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return None,
    };
    let rows: Vec<(String, i64, i64)> = match stmt.query_map([&xml_md5], |row| {
        let file_name: String = row.get(0)?;
        let dir1: i64 = row.get(1)?;
        let dir2: i64 = row.get(2)?;
        Ok((file_name, dir1, dir2))
    }) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => return None,
    };

    if rows.is_empty() {
        return None;
    }

    // Try each matching row to find an existing file
    for (file_name, dir1_idx, dir2_idx) in &rows {
        let dir1_name = dir_map.get(dir1_idx).cloned().unwrap_or_default();
        let dir2_name = dir_map.get(dir2_idx).cloned().unwrap_or_default();

        if dir1_name.is_empty() || dir2_name.is_empty() {
            continue;
        }

        // Build path: attach/{dir1_hash}/{date_prefix}/Img/{file_name}
        // Prefer _h.dat (PNG) over .dat (wxgf) over _t.dat (JPEG thumbnail)
        let base = if let Some(s) = file_name.strip_suffix("_h.dat") {
            s.to_string()
        } else if let Some(s) = file_name.strip_suffix("_t.dat") {
            s.to_string()
        } else if let Some(s) = file_name.strip_suffix("_M.dat") {
            s.to_string()
        } else if let Some(s) = file_name.strip_suffix(".dat") {
            s.to_string()
        } else {
            file_name.clone()
        };
        let variants = [
            format!("{}_h.dat", base),
            format!("{}_t.dat", base),
            format!("{}_M.dat", base),
            file_name.clone(),
        ];

        for variant in &variants {
            let full_path = attach_dir.join(&dir1_name).join(&dir2_name).join("Img").join(variant);
            if full_path.is_file() {
                return Some(full_path.to_string_lossy().to_string());
            }
        }
    }

    None
}

fn extract_attr(xml: &str, attr: &str) -> Option<String> {
    // Pattern: attr="value" or attr='value'
    let pattern_double = format!("{}=\"", attr);
    if let Some(start) = xml.find(&pattern_double) {
        let after = &xml[start + pattern_double.len()..];
        if let Some(end) = after.find('"') {
            return Some(after[..end].to_string());
        }
    }
    let pattern_single = format!("{}='", attr);
    if let Some(start) = xml.find(&pattern_single) {
        let after = &xml[start + pattern_single.len()..];
        if let Some(end) = after.find('\'') {
            return Some(after[..end].to_string());
        }
    }
    None
}

/// Check if a .dat filename matches the image md5 (filename is derived from md5)
fn dat_matches_md5(filename: &str, md5: &str) -> bool {
    // Strip suffixes and extension: _M.dat, _h.dat, _t.dat, .dat
    let base = if let Some(s) = filename.strip_suffix("_h.dat") {
        s
    } else if let Some(s) = filename.strip_suffix("_t.dat") {
        s
    } else if let Some(s) = filename.strip_suffix("_M.dat") {
        s
    } else if let Some(s) = filename.strip_suffix(".dat") {
        s
    } else {
        filename
    };
    // The filename may be the first N chars of the md5, or the full md5
    if base.len() >= 8 && md5.len() >= 8 {
        base == &md5[..base.len().min(md5.len())] || md5.starts_with(base)
    } else {
        false
    }
}

/// Classify a .dat file's quality for image preview.
/// Returns (priority, variant) where lower priority is better.
/// variant: 0=original/full, 1=hd, 2=medium, 3=thumb
fn classify_dat(name: &str, img_md5: &Option<String>) -> (u8, u8) {
    let is_match = img_md5.as_ref()
        .map(|md5| dat_matches_md5(name, md5))
        .unwrap_or(false);
    let match_bonus = if is_match { 0 } else { 4 };

    if name.ends_with("_t.dat") {
        (match_bonus + 3, 3) // thumb: lowest quality
    } else if name.ends_with("_h.dat") {
        (match_bonus + 1, 1) // hd: good quality
    } else if name.ends_with("_M.dat") {
        (match_bonus + 2, 2) // medium: decent quality
    } else if name.ends_with(".dat") {
        (match_bonus + 0, 0) // original: best quality
    } else {
        (255, 0) // not a .dat file
    }
}

/// Cache for attach directory subdirectories (keyed by attach_dir path).
/// Avoids repeated `read_dir` calls for every image message.
use std::sync::Mutex;

lazy_static::lazy_static! {
    static ref ATTACH_DIR_CACHE: Mutex<HashMap<String, Vec<String>>> = Mutex::new(HashMap::new());
}

fn get_attach_subdirs(attach_dir: &Path) -> Vec<String> {
    let key = attach_dir.to_string_lossy().to_string();
    {
        let cache = ATTACH_DIR_CACHE.lock().unwrap();
        if let Some(subdirs) = cache.get(&key) {
            return subdirs.clone();
        }
    }
    let mut subdirs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(attach_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            subdirs.push(name);
        }
    }
    let mut cache = ATTACH_DIR_CACHE.lock().unwrap();
    cache.insert(key, subdirs.clone());
    subdirs
}

fn resolve_media_path(
    db_dir: &Path,
    content: &str,
    local_type: i64,
    create_time_ts: i64,
    _chat_username: Option<&str>,
) -> (Option<String>, bool) {
    let (base_type, _) = split_msg_type(local_type);
    let wechat_base = match db_dir.parent() {
        Some(p) => p,
        None => return (None, false),
    };
    let msg_dir = wechat_base.join("msg");
    if !msg_dir.is_dir() {
        return (None, false);
    }

    let dt = match chrono::Local.timestamp_opt(create_time_ts, 0).single() {
        Some(d) => d,
        None => return (None, false),
    };
    let date_prefix = dt.format("%Y-%m").to_string();

    // 文件消息 (type 49, sub 6)
    if base_type == 49 && !content.is_empty() && content.contains("<appmsg") {
        if let Some(title) = extract_appmsg_title(content) {
            let file_dir = msg_dir.join("file").join(&date_prefix);
            if file_dir.is_dir() {
                let target = file_dir.join(&title);
                if target.is_file() {
                    return (Some(target.to_string_lossy().to_string()), true);
                }
                if let Ok(entries) = std::fs::read_dir(&file_dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.contains(&title) || title.contains(&name) {
                            return (Some(entry.path().to_string_lossy().to_string()), true);
                        }
                    }
                }
            }
        }
        return (None, false);
    }

    // 图片/语音/视频
    if base_type == 3 || base_type == 34 || base_type == 43 {
        let attach_dir = msg_dir.join("attach");
        if !attach_dir.is_dir() {
            return (None, false);
        }

        let sub_dir_name = if base_type == 3 { "Img" } else if base_type == 43 { "Video" } else { "Voice" };

        // Extract md5 from content to match the correct file
        let img_md5 = if base_type == 3 { extract_img_md5(content) } else { None };

        // Use cached subdirectory listing instead of repeated read_dir
        let subdirs = get_attach_subdirs(&attach_dir);

        // For images: try hardlink.db lookup first (most reliable for newer WeChat versions)
        // The hardlink.db maps md5 → actual file_name + directory path
        if base_type == 3 {
            if let Some(path) = resolve_image_via_hardlink(db_dir, content, &date_prefix, &attach_dir, sub_dir_name) {
                return (Some(path), true);
            }
        }

        // Try exact md5 match: build direct path and check existence
        if let Some(ref md5) = img_md5 {
            if !md5.is_empty() {
                for subdir_name in &subdirs {
                    let sub = attach_dir.join(subdir_name).join(&date_prefix).join(sub_dir_name);
                    if !sub.is_dir() {
                        continue;
                    }
                    // Try variants in priority order: hd > original > medium > thumb
                    let variants = [
                        format!("{}_h.dat", md5),
                        format!("{}_t.dat", md5),
                        format!("{}_M.dat", md5),
                        format!("{}.dat", md5),
                    ];
                    for variant in &variants {
                        let path = sub.join(variant);
                        if path.is_file() {
                            return (Some(path.to_string_lossy().to_string()), true);
                        }
                    }
                }
            }
        }

        // Fallback (no md5): scan for best match using cached subdirs
        let mut best_priority: u8 = 255;
        let mut best_path: Option<std::path::PathBuf> = None;

        for subdir_name in &subdirs {
            let sub = attach_dir.join(subdir_name).join(&date_prefix).join(sub_dir_name);
            if !sub.is_dir() {
                continue;
            }
            if let Ok(files) = std::fs::read_dir(&sub) {
                for file in files.flatten() {
                    let name = file.file_name().to_string_lossy().to_string();
                    let (priority, _) = classify_dat(&name, &img_md5);
                    if priority < best_priority {
                        best_priority = priority;
                        best_path = Some(file.path());
                        if priority == 0 {
                            return (Some(file.path().to_string_lossy().to_string()), true);
                        }
                    }
                }
            }
        }

        if let Some(p) = best_path {
            return (Some(p.to_string_lossy().to_string()), true);
        }

        if base_type == 43 {
            let video_dir = msg_dir.join("video").join(&date_prefix);
            if video_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&video_dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.ends_with("_thumb.jpg") {
                            return (Some(entry.path().to_string_lossy().to_string()), true);
                        }
                    }
                }
            }
        }
    }

    (None, false)
}

fn extract_appmsg_title(content: &str) -> Option<String> {
    if let Some(start) = content.find("<appmsg") {
        let rest = &content[start..];
        if let Some(title_start) = rest.find("<title>") {
            let after_title = &rest[title_start + 7..];
            if let Some(title_end) = after_title.find("</title>") {
                let title = after_title[..title_end].trim();
                // Clean CDATA wrappers
                let cleaned = title.replace("<![CDATA[", "").replace("]]>", "");
                return Some(cleaned);
            }
        }
    }
    None
}

fn extract_url_from_xml(content: &str) -> Option<String> {
    // Try <url> tag first (most common for WeChat articles)
    if let Some(start) = content.find("<url>") {
        let after = &content[start + 5..];
        if let Some(end) = after.find("</url>") {
            let url = after[..end].trim().to_string();
            if url.starts_with("http") {
                // Decode CDATA if present
                let decoded = url.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"");
                return Some(decoded);
            }
        }
    }
    // Try <sourcedisplayname> or <weappinfo><pagepath> patterns
    if let Some(start) = content.find("<weappinfo>") {
        let section = &content[start..];
        if let Some(pp_start) = section.find("<pagepath>") {
            let after = &section[pp_start + 10..];
            if let Some(pp_end) = after.find("</pagepath>") {
                let path = after[..pp_end].trim();
                if !path.is_empty() {
                    return Some(format!("weapp://{}", path));
                }
            }
        }
    }
    // Try plain http URL in content
    if let Some(pos) = content.find("http://") {
        let rest = &content[pos..];
        let url: String = rest.chars().take_while(|c| !c.is_whitespace() && *c != '<' && *c != '"').collect();
        if url.len() > 10 {
            return Some(url);
        }
    }
    if let Some(pos) = content.find("https://") {
        let rest = &content[pos..];
        let url: String = rest.chars().take_while(|c| !c.is_whitespace() && *c != '<' && *c != '"').collect();
        if url.len() > 10 {
            return Some(url);
        }
    }
    None
}

// ===== 格式化消息文本 =====

fn format_app_message_text(
    content: &str,
    local_type: i64,
    _is_group: bool,
    _chat_username: &str,
    _chat_display_name: &str,
    _names: &HashMap<String, String>,
    _display_name_fn: &dyn Fn(&str) -> String,
    resolve_media: bool,
    db_dir: Option<&Path>,
    create_time_ts: i64,
) -> Option<String> {
    if content.is_empty() || !content.contains("<appmsg") {
        return None;
    }
    let (_, sub_type) = split_msg_type(local_type);
    let app_type = parse_int(&sub_type.to_string(), sub_type as u64);

    let title = extract_appmsg_title(content).map(|s| collapse_text(&s)).unwrap_or_default();

    // 引用消息 (app_type 57)
    if app_type == 57 {
        let ref_content = if let Some(ref_start) = content.find("<refermsg") {
            let ref_section = &content[ref_start..];
            let ref_end = ref_section.find("</refermsg>").map(|e| e + 11).unwrap_or(0);
            if ref_end > 0 {
                let ref_xml = &ref_section[..ref_end];
                let display_name = if let Some(dn) = ref_xml.find("<displayname>") {
                    let after = &ref_xml[dn + 13..];
                    after.find("</displayname>").map(|e| &after[..e]).unwrap_or("")
                } else { "" };
                let ref_msg = if let Some(rc) = ref_xml.find("<content>") {
                    let after = &ref_xml[rc + 9..];
                    after.find("</content>").map(|e| collapse_text(&after[..e])).unwrap_or_default()
                } else { String::new() };
                let mut result = if title.is_empty() { "[引用消息]".to_string() } else { title.clone() };
                if !ref_msg.is_empty() {
                    let prefix = if !display_name.is_empty() {
                        format!("回复 {}: ", display_name)
                    } else { "回复: ".to_string() };
                    result += &format!("\n  ↳ {}{}", prefix, ref_msg);
                }
                return Some(result);
            }
        };
    }

    // 文件 (app_type 6)
    if app_type == 6 {
        if title.is_empty() {
            return Some("[文件]".to_string());
        }
        if resolve_media && db_dir.is_some() {
            let wechat_base = db_dir.unwrap().parent().unwrap();
            let msg_dir = wechat_base.join("msg/file");
            let dt = chrono::Local.timestamp_opt(create_time_ts, 0)
                .single()
                .map(|d| d.format("%Y-%m").to_string())
                .unwrap_or_default();
            let file_dir = msg_dir.join(&dt);
            if file_dir.is_dir() {
                let target = file_dir.join(&title);
                if target.is_file() {
                    return Some(format!("[文件] {}\n  {}", title, target.display()));
                }
            }
        }
        return Some(format!("[文件] {}", title));
    }

    // 链接 (app_type 5)
    if app_type == 5 {
        let url = extract_url_from_xml(content);
        if let Some(u) = &url {
            return Some(format!("[链接] {} {}", title, u));
        }
        return Some(format!("[链接] {}", title));
    }

    // 小程序 (app_type 33, 36, 44)
    if app_type == 33 || app_type == 36 || app_type == 44 {
        let url = extract_url_from_xml(content);
        if let Some(u) = &url {
            return Some(format!("[小程序] {} {}", title, u));
        }
        return Some(format!("[小程序] {}", title));
    }

    if !title.is_empty() {
        let url = extract_url_from_xml(content);
        if let Some(u) = &url {
            Some(format!("[链接/文件] {} {}", title, u))
        } else {
            Some(format!("[链接/文件] {}", title))
        }
    } else {
        Some("[链接/文件]".to_string())
    }
}

fn format_message_text(
    local_id: i64,
    local_type: i64,
    content: &str,
    is_group: bool,
    chat_username: &str,
    chat_display_name: &str,
    names: &HashMap<String, String>,
    display_name_fn: &dyn Fn(&str) -> String,
    db_dir: Option<&Path>,
    create_time_ts: i64,
    resolve_media: bool,
) -> (String, String) {
    let (sender, text) = parse_message_content(content, local_type, is_group);
    let (base_type, _) = split_msg_type(local_type);

    let result_text = match base_type {
        3 => {
            let mut media_info = String::new();
            if resolve_media && db_dir.is_some() && !content.is_empty() {
                let img_md5 = extract_img_md5(content);
                let (path, exists) = resolve_media_path(
                    db_dir.unwrap(), content, local_type, create_time_ts, Some(chat_username)
                );
                if let Some(p) = path {
                    media_info = if exists {
                        format!(" [图片] {}", p)
                    } else {
                        format!(" [图片] {} (文件不存在)", p)
                    };
                } else {
                    media_info = format!(" [图片] (local_id={})", local_id);
                }
            } else {
                media_info = format!(" [图片] (local_id={})", local_id);
            }
            media_info
        }
        47 => "[表情]".to_string(),
        50 => format_voip_message_text(&text),
        49 => {
            format_app_message_text(
                &text, local_type, is_group, chat_username, chat_display_name,
                names, display_name_fn, resolve_media, db_dir, create_time_ts,
            ).unwrap_or_else(|| "[链接/文件]".to_string())
        }
        _ => {
            let type_label = format_msg_type(local_type);
            if base_type != 1 {
                if text.is_empty() {
                    format!("[{}]", type_label)
                } else {
                    format!("[{}] {}", type_label, text)
                }
            } else {
                text
            }
        }
    };

    (sender, result_text)
}

fn format_voip_message_text(content: &str) -> String {
    if content.contains("<voip") {
        if content.contains("Duration:") {
            if let Some(dur) = content.split("Duration:").nth(1) {
                let duration = dur.trim().lines().next().unwrap_or("");
                return format!("[通话] 通话时长 {}", duration);
            }
        }
        if content.contains("Canceled") { return "[通话] 已取消".to_string(); }
        if content.contains("Line busy") { return "[通话] 对方忙线".to_string(); }
        if content.contains("not answered") { return "[通话] 未接听".to_string(); }
        return "[通话]".to_string();
    }
    "[通话]".to_string()
}

// ===== Name2Id =====

fn load_name2id_maps(conn: &rusqlite::Connection) -> HashMap<i64, String> {
    let mut map = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT rowid, user_name FROM Name2Id") {
        if let Ok(rows) = stmt.query_map([], |row| {
            let rowid: i64 = row.get(0)?;
            let user_name: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            Ok((rowid, user_name))
        }) {
            for row in rows.flatten() {
                if !row.1.is_empty() {
                    map.insert(row.0, row.1);
                }
            }
        }
    }
    map
}

// ===== 发送者解析 =====

fn resolve_sender_label(
    real_sender_id: i64,
    sender_from_content: &str,
    is_group: bool,
    chat_username: &str,
    _chat_display_name: &str,
    names: &HashMap<String, String>,
    id_to_username: &HashMap<i64, String>,
    display_name_fn: &dyn Fn(&str) -> String,
) -> String {
    let sender_username = id_to_username.get(&real_sender_id).cloned().unwrap_or_default();
    if is_group {
        if !sender_username.is_empty() && sender_username != chat_username {
            return display_name_fn(&sender_username);
        }
        if !sender_from_content.is_empty() {
            return display_name_fn(sender_from_content);
        }
        return String::new();
    }
    if sender_username == chat_username {
        return display_name_fn(chat_username);
    }
    if !sender_username.is_empty() {
        return display_name_fn(&sender_username);
    }
    String::new()
}

// ===== SQL 查询 =====

fn build_message_filters(
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    keyword: &str,
    msg_type_filter: Option<(u64, Option<u64>)>,
) -> (Vec<String>, Vec<Box<dyn rusqlite::types::ToSql>>) {
    let mut clauses = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ts) = start_ts {
        clauses.push("create_time >= ?".to_string());
        params.push(Box::new(ts));
    }
    if let Some(ts) = end_ts {
        clauses.push("create_time <= ?".to_string());
        params.push(Box::new(ts));
    }

    // 关键词搜索在 Rust 端解压后进行（数据可能被 zstd 压缩）
    // 此处不做 SQL LIKE 过滤

    if let Some((base_type, sub_type)) = msg_type_filter {
        clauses.push("(local_type & 0xFFFFFFFF) = ?".to_string());
        params.push(Box::new(base_type as i64));
        if let Some(st) = sub_type {
            clauses.push("((local_type >> 32) & 0xFFFFFFFF) = ?".to_string());
            params.push(Box::new(st as i64));
        }
    }

    (clauses, params)
}

fn _query_messages(
    conn: &rusqlite::Connection,
    table_name: &str,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    _keyword: &str,
    limit: Option<i64>,
    offset: i64,
    msg_type_filter: Option<(u64, Option<u64>)>,
) -> Result<Vec<(i64, i64, i64, i64, Vec<u8>, Option<i64>)>, String> {
    if !is_safe_msg_table_name(table_name) {
        return Err(format!("非法消息表名: {}", table_name));
    }

    let (clauses, params) = build_message_filters(start_ts, end_ts, _keyword, msg_type_filter);
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };

    let actual_limit = limit.unwrap_or(10000);
    let sql = format!(
        "SELECT local_id, local_type, create_time, real_sender_id, \
         message_content, WCDB_CT_message_content \
         FROM [{}] {} ORDER BY create_time DESC LIMIT ? OFFSET ?",
        table_name, where_sql
    );

    let mut stmt = conn.prepare(&sql)
        .map_err(|e| format!("准备查询失败: {}", e))?;

    let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    for p in params {
        all_params.push(p);
    }
    all_params.push(Box::new(actual_limit));
    all_params.push(Box::new(offset));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = all_params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        let local_id: i64 = row.get(0)?;
        let local_type: i64 = row.get(1)?;
        let create_time: i64 = row.get(2)?;
        let real_sender_id: i64 = row.get(3)?;
        // message_content may be BLOB (compressed) or TEXT (plain text)
        let content_bytes: Vec<u8> = row.get::<_, Vec<u8>>(4)
            .or_else(|_| row.get::<_, String>(4).map(|s| s.into_bytes()))?;
        let ct: Option<i64> = row.get(5)?;
        Ok((local_id, local_type, create_time, real_sender_id, content_bytes, ct))
    })
    .map_err(|e| format!("查询失败: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        if let Ok(r) = row {
            results.push(r);
        } else {
            log::warn!("_query_messages: skipping row due to read error");
        }
    }
    Ok(results)
}

// ===== 时间解析 =====

pub fn parse_time_value(value: &str, is_end: bool) -> Option<i64> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }

    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S") {
        return Some(dt.and_utc().timestamp());
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M") {
        return Some(dt.and_utc().timestamp());
    }
    if let Ok(d) = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        let dt = if is_end {
            d.and_hms_opt(23, 59, 59).unwrap()
        } else {
            d.and_hms_opt(0, 0, 0).unwrap()
        };
        return Some(dt.and_utc().timestamp());
    }
    None
}

// ===== 构建行 =====

fn build_history_line(
    row: &(i64, i64, i64, i64, Vec<u8>, Option<i64>),
    ctx: &serde_json::Value,
    names: &HashMap<String, String>,
    id_to_username: &HashMap<i64, String>,
    display_name_fn: &dyn Fn(&str) -> String,
    resolve_media: bool,
    db_dir: Option<&Path>,
) -> (i64, String) {
    let (local_id, local_type, create_time, real_sender_id, content_bytes, ct) = row;
    let time_str = chrono::Local.timestamp_opt(*create_time, 0)
        .single()
        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let content = decompress_content(content_bytes, *ct).unwrap_or_else(|| "(无法解压)".to_string());

    let is_group = ctx.get("is_group").and_then(|v| v.as_bool()).unwrap_or(false);
    let chat_username = ctx.get("username").and_then(|v| v.as_str()).unwrap_or("");
    let chat_display = ctx.get("display_name").and_then(|v| v.as_str()).unwrap_or("");

    let (sender, text) = format_message_text(
        *local_id, *local_type, &content, is_group, chat_username, chat_display,
        names, display_name_fn, db_dir, *create_time, resolve_media,
    );

    let sender_label = resolve_sender_label(
        *real_sender_id, &sender, is_group, chat_username, chat_display,
        names, id_to_username, display_name_fn,
    );

    if sender_label.is_empty() {
        (*create_time, format!("[{}] {}", time_str, text))
    } else {
        (*create_time, format!("[{}] {}: {}", time_str, sender_label, text))
    }
}

// ===== 聊天上下文 =====

fn find_msg_tables_for_user(
    username: &str,
    msg_db_keys: &[String],
    keys: &HashMap<String, Value>,
    cache: &mut DBCache,
) -> Vec<serde_json::Value> {
    let table_hash = format!("{:x}", Md5::digest(username.as_bytes()));
    let table_name = format!("Msg_{}", table_hash);

    if !is_safe_msg_table_name(&table_name) {
        return vec![];
    }

    let mut matches = Vec::new();
    for rel_key in msg_db_keys {
        let path = match cache.get(rel_key) {
            Some(p) => p,
            None => continue,
        };

        let conn = match rusqlite::Connection::open(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let exists: bool = conn.query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
            [&table_name],
            |_| Ok(true),
        ).unwrap_or(false);

        if !exists {
            continue;
        }

        let max_ct: i64 = conn.query_row(
            &format!("SELECT MAX(create_time) FROM [{}]", table_name),
            [],
            |row| row.get::<_, Option<i64>>(0),
        ).ok().flatten().unwrap_or(0);

        matches.push((max_ct, path, table_name.clone()));
    }

    matches.sort_by(|a, b| b.0.cmp(&a.0));
    matches.into_iter().map(|(max_ct, db_path, table_name)| {
        serde_json::json!({
            "db_path": db_path.to_string_lossy().to_string(),
            "table_name": table_name,
            "max_create_time": max_ct,
        })
    }).collect()
}

pub fn resolve_chat_context(
    chat_name: &str,
    msg_db_keys: &[String],
    keys: &HashMap<String, Value>,
    cache: &mut DBCache,
    decrypted_dir: &Path,
    db_dir: &Path,
) -> Option<serde_json::Value> {
    let username = resolve_username(chat_name, cache, decrypted_dir)?;
    let names = get_contact_names(cache, decrypted_dir);
    let display_name = names.get(&username).cloned().unwrap_or_else(|| username.clone());
    let message_tables = find_msg_tables_for_user(&username, msg_db_keys, keys, cache);

    Some(serde_json::json!({
        "query": chat_name,
        "username": username,
        "display_name": display_name,
        "is_group": username.contains("@chatroom"),
        "db_path": message_tables.first().and_then(|t| t.get("db_path")).cloned().unwrap_or_default(),
        "table_name": message_tables.first().and_then(|t| t.get("table_name")).cloned().unwrap_or_default(),
        "message_tables": message_tables,
    }))
}

pub fn resolve_chat_contexts(
    chat_names: &[String],
    msg_db_keys: &[String],
    keys: &HashMap<String, Value>,
    cache: &mut DBCache,
    decrypted_dir: &Path,
    db_dir: &Path,
) -> (Vec<serde_json::Value>, Vec<String>, Vec<String>) {
    let mut resolved = Vec::new();
    let mut unresolved = Vec::new();
    let mut missing_tables = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for chat_name in chat_names {
        let name = chat_name.trim();
        if name.is_empty() {
            unresolved.push("(空)".to_string());
            continue;
        }

        let ctx = resolve_chat_context(name, msg_db_keys, keys, cache, decrypted_dir, db_dir);
        match ctx {
            Some(ctx_val) => {
                let username = ctx_val.get("username").and_then(|v| v.as_str()).unwrap_or("");
                let tables = ctx_val.get("message_tables")
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);

                if tables == 0 {
                    let display = ctx_val.get("display_name").and_then(|v| v.as_str()).unwrap_or(name);
                    missing_tables.push(display.to_string());
                    continue;
                }

                if seen.contains(username) {
                    continue;
                }
                seen.insert(username.to_string());
                resolved.push(ctx_val);
            }
            None => {
                unresolved.push(name.to_string());
            }
        }
    }

    (resolved, unresolved, missing_tables)
}

// ===== 收集聊天记录 =====

pub fn collect_chat_history(
    ctx: &serde_json::Value,
    names: &HashMap<String, String>,
    display_name_fn: &dyn Fn(&str) -> String,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    limit: i64,
    offset: i64,
    msg_type_filter: Option<(u64, Option<u64>)>,
    resolve_media: bool,
    db_dir: Option<&Path>,
) -> (Vec<String>, Vec<String>) {
    let mut collected = Vec::new();
    let mut failures = Vec::new();
    let candidate_limit = limit + offset;

    let tables = ctx.get("message_tables")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for table_ctx in &tables {
        let db_path_str = table_ctx.get("db_path")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let table_name = table_ctx.get("table_name")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if db_path_str.is_empty() || table_name.is_empty() {
            continue;
        }

        let conn = match rusqlite::Connection::open(db_path_str) {
            Ok(c) => c,
            Err(e) => {
                failures.push(format!("{}: {}", db_path_str, e));
                continue;
            }
        };

        let id_to_username = load_name2id_maps(&conn);
        let mut fetch_offset = 0i64;

        loop {
            let rows = _query_messages(
                &conn, table_name, start_ts, end_ts, "",
                Some(candidate_limit.min(500)), fetch_offset, msg_type_filter,
            );

            match rows {
                Ok(rows_data) => {
                    if rows_data.is_empty() {
                        break;
                    }
                    fetch_offset += rows_data.len() as i64;

                    for row in &rows_data {
                        let ctx_inner = serde_json::json!({
                            "query": ctx.get("query"),
                            "username": ctx.get("username"),
                            "display_name": ctx.get("display_name"),
                            "is_group": ctx.get("is_group"),
                            "db_path": table_ctx.get("db_path"),
                            "table_name": table_ctx.get("table_name"),
                        });
                        let (_ts, line) = build_history_line(
                            row, &ctx_inner, names, &id_to_username,
                            display_name_fn, resolve_media, db_dir,
                        );
                        collected.push((_ts, line));

                        if (collected.len() as i64 - collected.first().map(|_| 0i64).unwrap_or(0)) >= candidate_limit {
                            break;
                        }
                    }

                    if (collected.len() as i64 - collected.first().map(|_| 0i64).unwrap_or(0)) >= candidate_limit {
                        break;
                    }
                    if rows_data.len() < 500 {
                        break;
                    }
                }
                Err(e) => {
                    failures.push(format!("{}: {}", table_name, e));
                    break;
                }
            }
        }
    }

    // 排序和分页
    collected.sort_by(|a, b| b.0.cmp(&a.0));
    let paged: Vec<(i64, String)> = collected.into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .collect();
    let mut paged = paged;
    paged.sort_by(|a, b| a.0.cmp(&b.0));

    (paged.into_iter().map(|(_, line)| line).collect(), failures)
}
