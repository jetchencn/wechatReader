use crate::config::Config;
use crate::db_cache::DBCache;
use crate::key_utils::{strip_key_metadata, find_msg_db_keys};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;

/// 应用上下文 — 持有配置、缓存、密钥等共享状态
pub struct AppContext {
    pub cfg: Config,
    pub db_dir: PathBuf,
    pub decrypted_dir: PathBuf,
    pub keys_file: PathBuf,
    pub keys: HashMap<String, Value>,
    pub msg_db_keys: Vec<String>,
    pub cache: RefCell<DBCache>,
}

impl AppContext {
    pub fn new(config_path: Option<&std::path::Path>) -> Result<Self, String> {
        let cfg = Config::load(config_path)?;
        let db_dir = std::path::Path::new(&cfg.db_dir).to_path_buf();
        let decrypted_dir = std::path::Path::new(&cfg.decrypted_dir).to_path_buf();
        let keys_file = std::path::Path::new(&cfg.keys_file).to_path_buf();

        // 确保状态目录存在
        std::fs::create_dir_all(crate::config::state_dir())
            .map_err(|e| format!("创建状态目录失败: {}", e))?;

        if !keys_file.exists() {
            return Err(format!(
                "密钥文件不存在: {}\n请运行: wechat-reader init",
                keys_file.display()
            ));
        }

        let keys_content = std::fs::read_to_string(&keys_file)
            .map_err(|e| format!("读取密钥文件失败: {}", e))?;
        let keys_raw: Value = serde_json::from_str(&keys_content)
            .map_err(|e| format!("解析密钥文件失败: {}", e))?;
        let keys = strip_key_metadata(&keys_raw);

        let msg_db_keys = find_msg_db_keys(&keys);
        let cache = RefCell::new(DBCache::new(keys.clone(), &db_dir));

        Ok(AppContext {
            cfg,
            db_dir,
            decrypted_dir,
            keys_file,
            keys,
            msg_db_keys,
            cache,
        })
    }
}
