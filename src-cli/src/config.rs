use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// CLI 状态目录（从 ~/wechat-cli 改为 ~/wechat-reader）
pub const STATE_DIR_NAME: &str = ".wechat-reader";

pub fn state_dir() -> PathBuf {
    let home = dirs::home_dir().expect("无法获取 home 目录");
    home.join(STATE_DIR_NAME)
}

pub fn config_file() -> PathBuf {
    state_dir().join("config.json")
}

pub fn keys_file() -> PathBuf {
    state_dir().join("all_keys.json")
}

pub fn last_check_file() -> PathBuf {
    state_dir().join("last_check.json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// 微信数据目录（db_storage 的父目录，即 xwechat_files/<wxid>）
    pub db_dir: String,
    /// 密钥文件路径
    #[serde(default)]
    pub keys_file: String,
    /// 解密缓存目录
    #[serde(default = "default_decrypted_dir")]
    pub decrypted_dir: String,
    /// 解码图片目录
    #[serde(default = "default_decoded_image_dir")]
    pub decoded_image_dir: String,
    /// 微信进程名
    #[serde(default = "default_process")]
    pub wechat_process: String,
    /// wechat_base_dir — 微信数据根目录（推导）
    #[serde(default)]
    pub wechat_base_dir: String,
}

fn default_decrypted_dir() -> String {
    state_dir().join("decrypted").to_string_lossy().to_string()
}

fn default_decoded_image_dir() -> String {
    state_dir().join("decoded_images").to_string_lossy().to_string()
}

fn default_process() -> String {
    if cfg!(target_os = "macos") {
        "WeChat".to_string()
    } else if cfg!(target_os = "windows") {
        "Weixin.exe".to_string()
    } else {
        "wechat".to_string()
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            db_dir: String::new(),
            keys_file: keys_file().to_string_lossy().to_string(),
            decrypted_dir: default_decrypted_dir(),
            decoded_image_dir: default_decoded_image_dir(),
            wechat_process: default_process(),
            wechat_base_dir: String::new(),
        }
    }
}

impl Config {
    /// 从文件加载配置
    pub fn load(path: Option<&Path>) -> Result<Self, String> {
        let default_path = config_file();
        let cfg_path = path.unwrap_or_else(|| Path::new(&default_path));
        let cfg: Config = if cfg_path.exists() {
            let content = std::fs::read_to_string(cfg_path)
                .map_err(|e| format!("读取配置失败: {}", e))?;
            serde_json::from_str(&content)
                .map_err(|e| format!("解析配置失败: {}", e))?
        } else {
            Config::default()
        };

        let mut cfg = cfg;
        let sd = state_dir();

        // 处理相对路径
        for key in ["keys_file", "decrypted_dir", "decoded_image_dir"].iter() {
            let val = match *key {
                "keys_file" => &mut cfg.keys_file,
                "decrypted_dir" => &mut cfg.decrypted_dir,
                "decoded_image_dir" => &mut cfg.decoded_image_dir,
                _ => unreachable!(),
            };
            let p = Path::new(val.as_str());
            if !p.is_absolute() {
                *val = sd.join(val.as_str()).to_string_lossy().to_string();
            }
        }
        let db_dir = &cfg.db_dir;
        if !db_dir.is_empty() {
            let db_path = Path::new(db_dir);
            let parent = db_path.parent();
            cfg.wechat_base_dir = parent
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
        }
        Ok(cfg)
    }

    /// 保存配置
    pub fn save(&self) -> Result<(), String> {
        let sd = state_dir();
        std::fs::create_dir_all(&sd).map_err(|e| format!("创建状态目录失败: {}", e))?;
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("序列化配置失败: {}", e))?;
        std::fs::write(config_file(), content)
            .map_err(|e| format!("写入配置失败: {}", e))
    }

    /// 获取 wechat_base_dir（db_storage 的父目录）
    pub fn wechat_base_dir(&self) -> PathBuf {
        let p = Path::new(&self.wechat_base_dir);
        if p.is_absolute() && p.exists() {
            p.to_path_buf()
        } else {
            Path::new(&self.db_dir)
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from(&self.db_dir))
        }
    }
}

// ===== 自动检测微信数据目录 =====

#[cfg(target_os = "macos")]
pub fn auto_detect_db_dir() -> Option<String> {
    let base = dirs::home_dir()?.join("Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files");
    if !base.is_dir() {
        return None;
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            let db_storage = entry.path().join("db_storage");
            if db_storage.is_dir() {
                candidates.push(db_storage);
            }
        }
    }
    choose_candidate(candidates)
}

#[cfg(target_os = "linux")]
pub fn auto_detect_db_dir() -> Option<String> {
    let base = dirs::home_dir()?.join("Documents/xwechat_files");
    if !base.is_dir() {
        return None;
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            let db_storage = entry.path().join("db_storage");
            if db_storage.is_dir() {
                candidates.push(db_storage);
            }
        }
    }
    // 按 mtime 排序
    candidates.sort_by(|a, b| {
        let ma = std::fs::metadata(a).and_then(|m| m.modified()).ok();
        let mb = std::fs::metadata(b).and_then(|m| m.modified()).ok();
        mb.cmp(&ma)
    });
    choose_candidate(candidates)
}

#[cfg(target_os = "windows")]
pub fn auto_detect_db_dir() -> Option<String> {
    let appdata = std::env::var("APPDATA").ok()?;
    let config_dir = Path::new(&appdata).join("Tencent/xwechat/config");
    if !config_dir.is_dir() {
        return None;
    }
    let mut data_roots: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&config_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("ini") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    let trimmed = content.trim();
                    if Path::new(trimmed).is_dir() {
                        data_roots.push(PathBuf::from(trimmed));
                    }
                }
            }
        }
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for root in &data_roots {
        let pattern_dir = root.join("xwechat_files");
        if pattern_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&pattern_dir) {
                for entry in entries.flatten() {
                    let db_storage = entry.path().join("db_storage");
                    if db_storage.is_dir() {
                        let normalized = db_storage.canonicalize().ok();
                        if let Some(n) = normalized {
                            if seen.insert(n.clone()) {
                                candidates.push(db_storage);
                            }
                        } else if seen.insert(db_storage.clone()) {
                            candidates.push(db_storage);
                        }
                    }
                }
            }
        }
    }
    choose_candidate(candidates)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub fn auto_detect_db_dir() -> Option<String> {
    None
}

fn choose_candidate(candidates: Vec<PathBuf>) -> Option<String> {
    if candidates.is_empty() {
        return None;
    }
    if candidates.len() == 1 {
        return candidates[0].to_str().map(|s| s.to_string());
    }
    // 多个候选：选择第一个（按 mtime 排序过的）
    Some(candidates[0].to_str().unwrap_or_default().to_string())
}
