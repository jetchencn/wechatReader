use crate::contacts::get_contact_names;
use crate::messages::{
    self, collect_chat_history, parse_time_value, resolve_chat_context, MSG_TYPE_FILTERS,
};
use std::collections::HashMap;

pub fn run(
    app: &super::AppContext,
    chat_name: &str,
    limit: i64,
    offset: i64,
    start_time: &str,
    end_time: &str,
    fmt: &str,
    msg_type: Option<&str>,
    media: bool,
) {
    let start_ts = parse_time_value(start_time, false);
    let end_ts = parse_time_value(end_time, true);

    let mut names_map: HashMap<String, String> = HashMap::new();
    let tmp = get_contact_names(&mut app.cache.borrow_mut(), &app.decrypted_dir);
    for (k, v) in tmp {
        names_map.insert(k, v);
    }

    let self_username = crate::contacts::get_self_username(
        &app.db_dir, &mut app.cache.borrow_mut(), &app.decrypted_dir
    );

    let display_name_fn = |username: &str| -> String {
        if username.is_empty() {
            return String::new();
        }
        if username == self_username {
            return "me".to_string();
        }
        names_map.get(username).cloned().unwrap_or_else(|| username.to_string())
    };

    let chat_ctx = resolve_chat_context(
        chat_name,
        &app.msg_db_keys,
        &app.keys,
        &mut app.cache.borrow_mut(),
        &app.decrypted_dir,
        &app.db_dir,
    );

    let chat_ctx = match chat_ctx {
        Some(c) => c,
        None => {
            eprintln!("找不到聊天对象: {}", chat_name);
            std::process::exit(1);
        }
    };

    if chat_ctx["db_path"].as_str().unwrap_or("").is_empty() {
        eprintln!("找不到 {} 的消息记录", chat_ctx["display_name"].as_str().unwrap_or(""));
        std::process::exit(1);
    }

    let type_filter = msg_type.and_then(|t| {
        MSG_TYPE_FILTERS.iter().find(|(name, _, _)| *name == t)
            .map(|(_, base, sub)| (*base, *sub))
    });

    let (lines, failures) = collect_chat_history(
        &chat_ctx, &names_map, &display_name_fn,
        start_ts, end_ts, limit, offset, type_filter, media,
        Some(&app.db_dir),
    );

    let display_name = chat_ctx["display_name"].as_str().unwrap_or(chat_name);
    let is_group = chat_ctx["is_group"].as_bool().unwrap_or(false);
    let username = chat_ctx["username"].as_str().unwrap_or("");

    if fmt == "json" {
        println!("{}", serde_json::to_string_pretty(&serde_json::json!({
            "chat": display_name,
            "username": username,
            "is_group": is_group,
            "count": lines.len(),
            "offset": offset,
            "limit": limit,
            "start_time": if start_time.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(start_time.to_string()) },
            "end_time": if end_time.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(end_time.to_string()) },
            "type": msg_type,
            "messages": lines,
            "failures": if failures.is_empty() { serde_json::Value::Null } else { serde_json::Value::Array(failures.iter().map(|f| serde_json::Value::String(f.clone())).collect()) },
        })).unwrap());
    } else {
        let mut header = format!("{} 的消息记录（返回 {} 条，offset={}, limit={}）",
            display_name, lines.len(), offset, limit);
        if is_group {
            header += " [群聊]";
        }
        if !start_time.is_empty() || !end_time.is_empty() {
            header += &format!("\n时间范围: {} ~ {}",
                if start_time.is_empty() { "最早" } else { start_time },
                if end_time.is_empty() { "最新" } else { end_time });
        }
        if !failures.is_empty() {
            header += &format!("\n查询失败: {}", failures.join("；"));
        }
        if lines.is_empty() {
            println!("{} 无消息记录", display_name);
        } else {
            println!("{}:\n\n{}", header, lines.join("\n"));
        }
    }
}
