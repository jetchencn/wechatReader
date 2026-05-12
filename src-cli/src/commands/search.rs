use crate::contacts::get_contact_names;
use crate::messages::{
    self, parse_time_value, resolve_chat_context, resolve_chat_contexts,
    MSG_TYPE_FILTERS,
};
use chrono::TimeZone;
use md5::{Digest, Md5};
use std::collections::HashMap;
use serde_json::Value;

pub fn run(
    app: &super::AppContext,
    keyword: &str,
    chat_names: &[String],
    start_time: &str,
    end_time: &str,
    limit: i64,
    offset: i64,
    fmt: &str,
    msg_type: Option<&str>,
) {
    let start_ts = parse_time_value(start_time, false);
    let end_ts = parse_time_value(end_time, true);

    let mut names_map: HashMap<String, String> = HashMap::new();
    let tmp = get_contact_names(&mut app.cache.borrow_mut(), &app.decrypted_dir);
    for (k, v) in tmp {
        names_map.insert(k, v);
    }

    let display_name_fn = |username: &str| -> String {
        if username.is_empty() {
            return String::new();
        }
        let self_usr = crate::contacts::get_self_username(
            &app.db_dir, &mut app.cache.borrow_mut(), &app.decrypted_dir
        );
        if username == self_usr {
            return "me".to_string();
        }
        names_map.get(username).cloned().unwrap_or_else(|| username.to_string())
    };

    let type_filter = msg_type.and_then(|t| {
        MSG_TYPE_FILTERS.iter().find(|(name, _, _)| *name == t)
            .map(|(_, base, sub)| (*base, *sub))
    });

    // 关键词搜索需要更大的批量（解压后过滤），设为 500
    let search_batch = if keyword.is_empty() { limit + offset } else { 500 };

    let (scope, entries, failures) = if chat_names.len() == 1 {
        // 单聊搜索
        let ctx = resolve_chat_context(
            &chat_names[0], &app.msg_db_keys, &app.keys,
            &mut app.cache.borrow_mut(), &app.decrypted_dir, &app.db_dir,
        );
        match ctx {
            Some(ctx_val) => {
                let display = ctx_val["display_name"].as_str().unwrap_or(&chat_names[0]).to_string();
                let (e, f) = search_in_chat(&ctx_val, keyword, &names_map, &display_name_fn,
                    start_ts, end_ts, search_batch, type_filter);
                (display, e, f)
            }
            None => {
                eprintln!("找不到聊天对象: {}", chat_names[0]);
                std::process::exit(1);
            }
        }
    } else if chat_names.len() > 1 {
        // 多聊搜索
        let (resolved, unresolved, missing) = resolve_chat_contexts(
            chat_names, &app.msg_db_keys, &app.keys,
            &mut app.cache.borrow_mut(), &app.decrypted_dir, &app.db_dir,
        );
        let mut all_entries = Vec::new();
        let mut all_failures = Vec::new();
        for rc in &resolved {
            let (e, f) = search_in_chat(rc, keyword, &names_map, &display_name_fn,
                start_ts, end_ts, limit + offset, type_filter);
            all_entries.extend(e);
            all_failures.extend(f);
        }
        if !unresolved.is_empty() {
            all_failures.push(format!("未找到: {}", unresolved.join("、")));
        }
        (format!("{} 个聊天对象", resolved.len()), all_entries, all_failures)
    } else {
        // 全局搜索
        global_search(app, keyword, &names_map, &display_name_fn,
            start_ts, end_ts, limit + offset, type_filter)
    };

    // 分页
    let mut paged: Vec<(i64, String)> = entries;
    paged.sort_by(|a, b| b.0.cmp(&a.0));
    let paged: Vec<String> = paged.into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|(_, s)| s)
        .collect();

    if fmt == "json" {
        println!("{}", serde_json::to_string_pretty(&serde_json::json!({
            "scope": scope,
            "keyword": keyword,
            "count": paged.len(),
            "offset": offset,
            "limit": limit,
            "start_time": if start_time.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(start_time.to_string()) },
            "end_time": if end_time.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(end_time.to_string()) },
            "type": msg_type,
            "results": paged,
            "failures": if failures.is_empty() { serde_json::Value::Null } else { serde_json::Value::Array(failures.iter().map(|f| serde_json::Value::String(f.clone())).collect()) },
        })).unwrap());
    } else {
        if paged.is_empty() {
            println!("在 {} 中未找到包含 \"{}\" 的消息", scope, keyword);
            return;
        }
        let mut header = format!("在 {} 中搜索 \"{}\" 找到 {} 条结果（offset={}, limit={}）",
            scope, keyword, paged.len(), offset, limit);
        if !start_time.is_empty() || !end_time.is_empty() {
            header += &format!("\n时间范围: {} ~ {}",
                if start_time.is_empty() { "最早" } else { start_time },
                if end_time.is_empty() { "最新" } else { end_time });
        }
        if !failures.is_empty() {
            header += &format!("\n查询失败: {}", failures.join("；"));
        }
        println!("{}:\n\n{}", header, paged.join("\n\n"));
    }
}

fn search_in_chat(
    ctx: &Value,
    keyword: &str,
    names: &HashMap<String, String>,
    display_name_fn: &dyn Fn(&str) -> String,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    max_results: i64,
    msg_type_filter: Option<(u64, Option<u64>)>,
) -> (Vec<(i64, String)>, Vec<String>) {
    let tables = ctx["message_tables"].as_array().cloned().unwrap_or_default();
    let mut collected = Vec::new();
    let mut failures = Vec::new();
    let is_group = ctx["is_group"].as_bool().unwrap_or(false);
    let chat_username = ctx["username"].as_str().unwrap_or("");
    let chat_display = ctx["display_name"].as_str().unwrap_or("");

    // 兼容没有 message_tables 的上下文（如 global_search 直接构造的简单上下文）
    let table_list: Vec<Value> = if tables.is_empty() {
        if let Some(db_path) = ctx["db_path"].as_str() {
            if let Some(table_name) = ctx["table_name"].as_str() {
                vec![serde_json::json!({
                    "db_path": db_path,
                    "table_name": table_name,
                })]
            } else {
                vec![]
            }
        } else {
            vec![]
        }
    } else {
        tables
    };

    for table_ctx in &table_list {
        let db_path = table_ctx["db_path"].as_str().unwrap_or("");
        let table_name = table_ctx["table_name"].as_str().unwrap_or("");
        if db_path.is_empty() || table_name.is_empty() {
            continue;
        }

        let conn = match rusqlite::Connection::open(db_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let id_to_username = crate::messages::load_name2id_internal(&conn);

        let rows = match crate::messages::query_messages(
            &conn, table_name, start_ts, end_ts, keyword,
            Some(max_results), 0, msg_type_filter,
        ) {
            Ok(r) => r,
            Err(_) => continue,
        };

        for row in &rows {
            let (local_id, local_type, create_time, real_sender_id, content_bytes, ct) = row;
            let content = crate::messages::decompress_content_internal(content_bytes, ct.unwrap_or(0))
                .unwrap_or_else(|| "(无法解压)".to_string());

            let (sender, text) = crate::messages::format_message_text_internal(
                *local_id, *local_type, &content, is_group, chat_username, chat_display,
                names, display_name_fn, None, *create_time, false,
            );

            if !keyword.is_empty() && !text.to_lowercase().contains(&keyword.to_lowercase()) {
                continue;
            }

            let sender_label = if is_group {
                let sender_username = id_to_username.get(real_sender_id).cloned().unwrap_or_default();
                if !sender_username.is_empty() && sender_username != chat_username {
                    display_name_fn(&sender_username)
                } else if !sender.is_empty() {
                    display_name_fn(&sender)
                } else { String::new() }
            } else {
                // For person chats, use sender from parse_message_content.
                // The content format is "DisplayName:\nmessage" where DisplayName
                // is the contact's display name or the user's display name.
                // If sender is empty, fall back to real_sender_id.
                if !sender.is_empty() {
                    // sender from content is the raw display name (may include emoji)
                    // If it contains chat_display, it's the contact; otherwise "me"
                    if sender.contains(chat_display) || chat_display.contains(&sender) {
                        chat_display.to_string()
                    } else {
                        "me".to_string()
                    }
                } else {
                    let sender_username = id_to_username.get(real_sender_id).cloned().unwrap_or_default();
                    if !sender_username.is_empty() && sender_username == chat_username {
                        chat_display.to_string()
                    } else {
                        "me".to_string()
                    }
                }
            };

            let time_str = chrono::Local.timestamp_opt(*create_time, 0)
                .single()
                .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_default();

            let mut entry = format!("[{}] [{}]", time_str, chat_display);
            if !sender_label.is_empty() {
                entry += &format!(" {}:", sender_label);
            }
            entry += &format!(" {}", text);

            if entry.len() > 300 {
                let mut boundary = 300;
                while !entry.is_char_boundary(boundary) {
                    boundary -= 1;
                }
                entry = entry[..boundary].to_string() + "...";
            }
            collected.push((*create_time, entry));
        }
    }

    // Sort collected results by timestamp descending (newest first) across all tables
    collected.sort_by(|a, b| b.0.cmp(&a.0));

    (collected, failures)
}

fn global_search(
    app: &super::AppContext,
    keyword: &str,
    names: &HashMap<String, String>,
    display_name_fn: &dyn Fn(&str) -> String,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    max_results: i64,
    msg_type_filter: Option<(u64, Option<u64>)>,
) -> (String, Vec<(i64, String)>, Vec<String>) {
    let mut collected = Vec::new();
    let mut failures = Vec::new();

    for rel_key in &app.msg_db_keys {
        let db_path = match app.cache.borrow_mut().get(rel_key) {
            Some(p) => p,
            None => continue,
        };

        let conn = match rusqlite::Connection::open(&db_path) {
            Ok(c) => c,
            Err(e) => {
                failures.push(format!("{}: {}", rel_key, e));
                continue;
            }
        };

        // 加载该 DB 的所有消息表
        let mut stmt = match conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'") {
            Ok(s) => s,
            Err(_) => continue,
        };

        let table_names: Vec<String> = stmt.query_map([], |row| {
            row.get::<_, String>(0)
        }).ok().map(|rows| rows.filter_map(|r| r.ok()).collect()).unwrap_or_default();

        let mut table_to_username: HashMap<String, String> = HashMap::new();
        if let Ok(mut nt) = conn.prepare("SELECT user_name FROM Name2Id") {
            if let Ok(rows) = nt.query_map([], |row| row.get::<_, String>(0)) {
                for row in rows.flatten() {
                    let hash = format!("{:x}", Md5::digest(row.as_bytes()));
                    table_to_username.insert(format!("Msg_{}", hash), row);
                }
            }
        }

        let id_to_username = crate::messages::load_name2id_internal(&conn);

        for table_name in &table_names {
            let username = table_to_username.get(table_name.as_str()).cloned().unwrap_or_default();
            let display = if username.is_empty() {
                table_name.clone()
            } else {
                names.get(&username).cloned().unwrap_or_else(|| username.clone())
            };
            let is_group = username.contains("@chatroom");

            let ctx_inner = serde_json::json!({
                "is_group": is_group,
                "username": username,
                "display_name": display,
                "db_path": db_path.to_string_lossy().to_string(),
                "table_name": table_name,
            });

            let (e, f) = search_in_chat(&ctx_inner, keyword, names, display_name_fn,
                start_ts, end_ts, max_results, msg_type_filter);
            collected.extend(e);
            failures.extend(f);
        }
    }

    ("全部消息".to_string(), collected, failures)
}
