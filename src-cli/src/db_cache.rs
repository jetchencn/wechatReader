use crate::crypto::{decrypt_wal, full_decrypt};
use crate::key_utils::{get_enc_key_hex, get_key_info};
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// 解密数据库缓存（mtime 检测变化，跨会话复用）
pub struct DBCache {
    all_keys: HashMap<String, Value>,
    db_dir: PathBuf,
    cache: HashMap<String, CacheEntry>,
    persistent_path: PathBuf,
    cache_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheEntry {
    db_mt: u64,
    wal_mt: u64,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistentCache {
    entries: HashMap<String, CacheEntry>,
}

impl DBCache {
    pub fn new(all_keys: HashMap<String, Value>, db_dir: &Path) -> Self {
        let tmp_dir = std::env::temp_dir().join("wechat_reader_cache");
        std::fs::create_dir_all(&tmp_dir).ok();

        let persistent_path = tmp_dir.join("_mtimes.json");
        let mut cache = HashMap::new();

        // 加载持久化缓存
        if let Ok(content) = std::fs::read_to_string(&persistent_path) {
            if let Ok(pc) = serde_json::from_str::<PersistentCache>(&content) {
                for (rel_key, entry) in &pc.entries {
                    let tmp_path = Path::new(&entry.path);
                    if !tmp_path.exists() {
                        continue;
                    }
                    let rel_path = rel_key.replace('\\', std::path::MAIN_SEPARATOR_STR);
                    let db_path = db_dir.join(&rel_path);
                    let wal_path = db_path.with_extension("db-wal");

                    let db_mt = std::fs::metadata(&db_path).ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let wal_mt = if wal_path.exists() {
                        std::fs::metadata(&wal_path).ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0)
                    } else {
                        0
                    };

                    if db_mt == entry.db_mt && wal_mt == entry.wal_mt {
                        cache.insert(rel_key.clone(), CacheEntry {
                            db_mt,
                            wal_mt,
                            path: entry.path.clone(),
                        });
                    }
                }
            }
        }

        DBCache {
            all_keys,
            db_dir: db_dir.to_path_buf(),
            cache,
            persistent_path,
            cache_dir: tmp_dir,
        }
    }

    fn cache_path(&self, rel_key: &str) -> PathBuf {
        let hash = format!("{:x}", Md5::digest(rel_key.as_bytes()));
        self.cache_dir.join(format!("{}.db", &hash[..12]))
    }

    fn save_persistent(&self) {
        let mut entries = HashMap::new();
        for (rel_key, entry) in &self.cache {
            entries.insert(rel_key.clone(), entry.clone());
        }
        let pc = PersistentCache { entries };
        if let Ok(content) = serde_json::to_string(&pc) {
            std::fs::write(&self.persistent_path, content).ok();
        }
    }

    /// 获取解密后的数据库路径
    pub fn get(&mut self, rel_key: &str) -> Option<PathBuf> {
        let key_info = get_key_info(&self.all_keys, rel_key)?;
        let enc_key_hex = get_enc_key_hex(key_info)?;
        let enc_key = hex::decode(&enc_key_hex).ok()?;

        let rel_path = rel_key.replace('\\', "/").replace('/', std::path::MAIN_SEPARATOR_STR);
        let db_path = self.db_dir.join(&rel_path);
        let wal_path = db_path.with_extension("db-wal");

        if !db_path.exists() {
            return None;
        }

        let db_mt = std::fs::metadata(&db_path).ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let wal_mt = if wal_path.exists() {
            std::fs::metadata(&wal_path).ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0)
        } else {
            0
        };

        // 检查缓存是否最新
        if let Some(entry) = self.cache.get(rel_key) {
            let tmp_path = Path::new(&entry.path);
            if entry.db_mt == db_mt && entry.wal_mt == wal_mt && tmp_path.exists() {
                return Some(tmp_path.to_path_buf());
            }
        }

        // 重新解密
        let tmp_path = self.cache_path(rel_key);
        if let Err(e) = full_decrypt(&db_path, &tmp_path, &enc_key) {
            log::error!("解密 {} 失败: {}", rel_key, e);
            return None;
        }
        if let Err(e) = decrypt_wal(&wal_path, &tmp_path, &enc_key) {
            log::warn!("解密 WAL {} 失败: {}", rel_key, e);
        }

        self.cache.insert(rel_key.to_string(), CacheEntry {
            db_mt,
            wal_mt,
            path: tmp_path.to_string_lossy().to_string(),
        });
        self.save_persistent();

        Some(tmp_path)
    }

    pub fn cleanup(&self) {
        self.save_persistent();
    }
}
