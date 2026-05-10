use serde_json::Value;
use std::collections::HashMap;

/// 移除元数据键（_ 开头的键）
pub fn strip_key_metadata(keys: &Value) -> HashMap<String, Value> {
    let mut result = HashMap::new();
    if let Some(obj) = keys.as_object() {
        for (k, v) in obj {
            if !k.starts_with('_') {
                result.insert(k.clone(), v.clone());
            }
        }
    }
    result
}

/// 生成路径变体
pub fn key_path_variants(rel_path: &str) -> Vec<String> {
    let normalized = rel_path.replace('\\', "/");
    let mut variants: Vec<String> = Vec::new();
    for candidate in [
        rel_path.to_string(),
        normalized.clone(),
        normalized.replace('/', "\\"),
        normalized.replace('/', std::path::MAIN_SEPARATOR_STR),
    ] {
        if !variants.contains(&candidate) {
            variants.push(candidate);
        }
    }
    variants
}

/// 在密钥字典中查找目标密钥信息
pub fn get_key_info<'a>(keys: &'a HashMap<String, Value>, rel_path: &str) -> Option<&'a Value> {
    for variant in key_path_variants(rel_path) {
        if let Some(val) = keys.get(&variant) {
            return Some(val);
        }
    }
    None
}

/// 从密钥信息中提取 enc_key（十六进制字符串）
pub fn get_enc_key_hex(info: &Value) -> Option<String> {
    info.get("enc_key")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// 从密钥字典中查找消息数据库密钥
pub fn find_msg_db_keys(keys: &HashMap<String, Value>) -> Vec<String> {
    let mut msg_keys: Vec<String> = Vec::new();
    for (k, _) in keys {
        let variants = key_path_variants(k);
        let is_msg = variants.iter().any(|v| {
            v.starts_with("message/") || v.starts_with("message\\")
        }) && variants.iter().any(|v| {
            regex::Regex::new(r"message_\d+\.db$")
                .ok()
                .map(|re| re.is_match(v))
                .unwrap_or(false)
        });
        if is_msg {
            msg_keys.push(k.clone());
        }
    }
    msg_keys.sort();
    msg_keys
}
