use crate::db_cache::DBCache;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactInfo {
    pub username: String,
    pub nick_name: String,
    pub remark: String,
    pub alias: String,
    pub description: String,
    pub avatar: String,
    pub verify_flag: i64,
    pub local_type: i64,
    pub is_group: bool,
    pub is_subscription: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMember {
    pub username: String,
    pub nick_name: String,
    pub remark: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMembers {
    pub members: Vec<GroupMember>,
    pub owner: String,
}

/// 从解密后的 contact.db 加载联系人
fn load_contacts_from(db_path: &Path) -> Result<(HashMap<String, String>, Vec<serde_json::Value>), String> {
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("打开 contact.db 失败: {}", e))?;

    let mut stmt = conn.prepare("SELECT username, nick_name, remark, small_head_url FROM contact")
        .map_err(|e| format!("查询联系人失败: {}", e))?;

    let mut names = HashMap::new();
    let mut full = Vec::new();

    let rows = stmt.query_map([], |row| {
        let username: String = row.get(0)?;
        let nick_name: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
        let remark: String = row.get::<_, Option<String>>(2)?.unwrap_or_default();
        let avatar: String = row.get::<_, Option<String>>(3)?.unwrap_or_default();
        let display = if !remark.is_empty() {
            remark.clone()
        } else if !nick_name.is_empty() {
            nick_name.clone()
        } else {
            username.clone()
        };
        Ok((username, nick_name, remark, display, avatar))
    }).map_err(|e| format!("读取联系人失败: {}", e))?;

    for row in rows {
        if let Ok((username, nick_name, remark, display, avatar)) = row {
            names.insert(username.clone(), display);
            full.push(serde_json::json!({
                "username": username,
                "nick_name": nick_name,
                "remark": remark,
                "avatar": avatar,
            }));
        }
    }
    Ok((names, full))
}

/// 获取联系人昵称映射（全局缓存）
pub fn get_contact_names(cache: &mut DBCache, decrypted_dir: &Path) -> HashMap<String, String> {
    let pre_decrypted = decrypted_dir.join("contact/contact.db");
    if pre_decrypted.exists() {
        if let Ok((names, _)) = load_contacts_from(&pre_decrypted) {
            return names;
        }
    }
    if let Some(path) = cache.get("contact/contact.db") {
        if let Ok((names, _)) = load_contacts_from(&path) {
            return names;
        }
    }
    HashMap::new()
}

/// 获取完整联系人列表
pub fn get_contact_full(cache: &mut DBCache, decrypted_dir: &Path) -> Vec<serde_json::Value> {
    let pre_decrypted = decrypted_dir.join("contact/contact.db");
    if pre_decrypted.exists() {
        if let Ok((_, full)) = load_contacts_from(&pre_decrypted) {
            return full;
        }
    }
    if let Some(path) = cache.get("contact/contact.db") {
        if let Ok((_, full)) = load_contacts_from(&path) {
            return full;
        }
    }
    Vec::new()
}

/// 根据聊天名称解析 username
pub fn resolve_username(chat_name: &str, cache: &mut DBCache, decrypted_dir: &Path) -> Option<String> {
    let names = get_contact_names(cache, decrypted_dir);
    // Direct match: already a username (wxid_*, @chatroom, @openim, etc.) or in contact map
    if names.contains_key(chat_name)
        || chat_name.starts_with("wxid_")
        || chat_name.contains('@')
    {
        return Some(chat_name.to_string());
    }
    let chat_lower = chat_name.to_lowercase();
    for (uname, display) in &names {
        if chat_lower == display.to_lowercase() {
            return Some(uname.clone());
        }
    }
    for (uname, display) in &names {
        if display.to_lowercase().contains(&chat_lower) {
            return Some(uname.clone());
        }
    }
    None
}

/// 获取当前登录用户
pub fn get_self_username(db_dir: &Path, cache: &mut DBCache, decrypted_dir: &Path) -> String {
    let names = get_contact_names(cache, decrypted_dir);
    if let Some(account_dir) = db_dir.parent() {
        if let Some(dirname) = account_dir.file_name().and_then(|s| s.to_str()) {
            let candidates = if let Some(idx) = dirname.rfind('_') {
                let (prefix, _) = dirname.split_at(idx);
                vec![prefix.to_string(), dirname.to_string()]
            } else {
                vec![dirname.to_string()]
            };
            for candidate in candidates {
                if names.contains_key(&candidate) {
                    return candidate;
                }
            }
        }
    }
    String::new()
}

/// 获取群聊成员
pub fn get_group_members(chatroom_username: &str, cache: &mut DBCache, decrypted_dir: &Path) -> GroupMembers {
    let db_path = {
        let pre = decrypted_dir.join("contact/contact.db");
        if pre.exists() {
            pre
        } else if let Some(p) = cache.get("contact/contact.db") {
            p
        } else {
            return GroupMembers { members: vec![], owner: String::new() };
        }
    };

    let names = get_contact_names(cache, decrypted_dir);
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return GroupMembers { members: vec![], owner: String::new() },
    };

    // 1. 找到 chatroom 的 contact.id
    let room_id: i64 = match conn.query_row(
        "SELECT id FROM contact WHERE username = ?1",
        [chatroom_username],
        |row| row.get(0),
    ) {
        Ok(id) => id,
        Err(_) => return GroupMembers { members: vec![], owner: String::new() },
    };

    // 2. 获取群主
    let owner = conn.query_row(
        "SELECT owner FROM chat_room WHERE id = ?1",
        [room_id],
        |row| row.get::<_, String>(0),
    ).ok()
    .and_then(|o| {
        if o.is_empty() { None } else { Some(names.get(&o).cloned().unwrap_or(o)) }
    })
    .unwrap_or_default();

    // 3. 获取成员
    let member_ids: Vec<i64> = (|| -> Option<Vec<i64>> {
        let mut stmt = conn.prepare("SELECT member_id FROM chatroom_member WHERE room_id = ?1")
            .ok()?;
        let ids: Vec<i64> = stmt.query_map([room_id], |row| row.get(0))
            .ok()?
            .filter_map(|r| r.ok())
            .collect();
        Some(ids)
    })().unwrap_or_default();

    if member_ids.is_empty() {
        return GroupMembers { members: vec![], owner };
    }

    let placeholders: Vec<String> = member_ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "SELECT id, username, nick_name, remark FROM contact WHERE id IN ({})",
        placeholders.join(",")
    );

    let mut stmt = conn.prepare(&sql).unwrap_or_else(|_| {
        // 创建空语句避免 panic
        conn.prepare("SELECT 1 WHERE 0").unwrap()
    });

    let mut members: Vec<GroupMember> = Vec::new();
    if let Ok(rows) = stmt.query_map(
        rusqlite::params_from_iter(member_ids.iter()),
        |row| {
            let _id: i64 = row.get(0)?;
            let username: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let nick: String = row.get::<_, Option<String>>(2)?.unwrap_or_default();
            let remark: String = row.get::<_, Option<String>>(3)?.unwrap_or_default();
            let display = if !remark.is_empty() { remark.clone() } else if !nick.is_empty() { nick.clone() } else { username.clone() };
            Ok(GroupMember {
                username,
                nick_name: nick,
                remark,
                display_name: display,
            })
        },
    ) {
        for row in rows.flatten() {
            members.push(row);
        }
    }

    // 群主排最前
    members.sort_by(|a, b| {
        let a_is_owner = a.username == owner;
        let b_is_owner = b.username == owner;
        b_is_owner.cmp(&a_is_owner).then(a.display_name.cmp(&b.display_name))
    });

    GroupMembers { members, owner }
}

/// 获取联系人详情
pub fn get_contact_detail(username: &str, cache: &mut DBCache, decrypted_dir: &Path) -> Option<ContactInfo> {
    let db_path = {
        let pre = decrypted_dir.join("contact/contact.db");
        if pre.exists() {
            pre
        } else if let Some(p) = cache.get("contact/contact.db") {
            p
        } else {
            return None;
        }
    };

    let conn = rusqlite::Connection::open(&db_path).ok()?;
    let row = conn.query_row(
        "SELECT username, nick_name, remark, alias, description, small_head_url, big_head_url, verify_flag, local_type FROM contact WHERE username = ?1",
        [username],
        |row| {
            let uname: String = row.get(0)?;
            let nick: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let remark: String = row.get::<_, Option<String>>(2)?.unwrap_or_default();
            let alias: String = row.get::<_, Option<String>>(3)?.unwrap_or_default();
            let desc: String = row.get::<_, Option<String>>(4)?.unwrap_or_default();
            let small_url: String = row.get::<_, Option<String>>(5)?.unwrap_or_default();
            let big_url: String = row.get::<_, Option<String>>(6)?.unwrap_or_default();
            let verify: i64 = row.get(7)?;
            let ltype: i64 = row.get(8)?;
            Ok((uname, nick, remark, alias, desc, small_url, big_url, verify, ltype))
        },
    ).ok()?;

    let (uname, nick, remark, alias, desc, small_url, big_url, verify, ltype) = row;
    let is_group = uname.contains("@chatroom");
    let is_subscription = uname.starts_with("gh_");
    Some(ContactInfo {
        username: uname,
        nick_name: nick,
        remark,
        alias,
        description: desc,
        avatar: if !small_url.is_empty() { small_url } else { big_url },
        verify_flag: verify,
        local_type: ltype,
        is_group,
        is_subscription,
    })
}

/// 根据 username 获取显示名称
pub fn display_name_for_username(
    username: &str,
    names: &HashMap<String, String>,
    db_dir: &Path,
    cache: &mut DBCache,
    decrypted_dir: &Path,
) -> String {
    if username.is_empty() {
        return String::new();
    }
    let self_username = get_self_username(db_dir, cache, decrypted_dir);
    if username == self_username {
        return "me".to_string();
    }
    names.get(username).cloned().unwrap_or_else(|| username.to_string())
}
