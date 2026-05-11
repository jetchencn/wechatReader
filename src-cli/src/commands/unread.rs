use crate::contacts::get_contact_names;
use crate::messages::format_msg_type;
use std::collections::HashMap;

pub fn run(
    app: &super::AppContext,
    limit: i64,
    fmt: &str,
) {
    let rel_key = if cfg!(target_os = "windows") {
        "session\\session.db"
    } else {
        "session/session.db"
    };

    let db_path = match app.cache.borrow_mut().get(rel_key) {
        Some(p) => p,
        None => {
            eprintln!("错误: 无法解密 session.db");
            std::process::exit(3);
        }
    };

    let mut names_map: HashMap<String, String> = HashMap::new();
    let tmp = get_contact_names(&mut app.cache.borrow_mut(), &app.decrypted_dir);
    for (k, v) in tmp {
        names_map.insert(k, v);
    }

    let conn = rusqlite::Connection::open(&db_path)
        .expect("无法打开 session.db");

    let mut stmt = conn.prepare(
        "SELECT username, unread_count, summary, last_timestamp, \
         last_msg_type, last_msg_sender, last_sender_display_name \
         FROM SessionTable \
         WHERE unread_count > 0 \
         ORDER BY last_timestamp DESC \
         LIMIT ?1"
    ).expect("准备查询失败");

    let rows = stmt.query_map([limit], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<i64>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
        ))
    }).expect("查询失败");

    let mut results = Vec::new();
    for row in rows.flatten() {
        let (username, unread, summary, ts, msg_type, sender, sender_name) = row;
        let display = names_map.get(&username).cloned().unwrap_or_else(|| username.clone());
        let is_group = username.contains("@chatroom");

        let summary_text = summary
            .map(|s| if s.contains(":\n") { s.split(":\n").nth(1).unwrap_or(&s).to_string() } else { s })
            .unwrap_or_default();

        let sender_display = if is_group {
            sender.as_ref()
                .and_then(|s| names_map.get(s))
                .cloned()
                .or_else(|| sender_name.clone())
                .unwrap_or_default()
        } else { String::new() };

        let time_str = chrono::DateTime::from_timestamp(ts, 0)
            .map(|dt| dt.format("%m-%d %H:%M").to_string())
            .unwrap_or_default();

        results.push(serde_json::json!({
            "chat": display,
            "username": username,
            "is_group": is_group,
            "unread": unread.unwrap_or(0),
            "last_message": summary_text,
            "msg_type": format_msg_type(msg_type),
            "sender": sender_display,
            "timestamp": ts,
            "time": time_str,
        }));
    }

    if fmt == "json" {
        println!("{}", serde_json::to_string_pretty(&results).unwrap());
    } else {
        if results.is_empty() {
            println!("没有未读消息");
            return;
        }
        println!("未读会话（{} 个）:\n", results.len());
        for r in &results {
            let chat = r["chat"].as_str().unwrap_or("");
            let time = r["time"].as_str().unwrap_or("");
            let unread = r["unread"].as_i64().unwrap_or(0);
            let msg_type = r["msg_type"].as_str().unwrap_or("");
            let sender = r["sender"].as_str().unwrap_or("");
            let last_msg = r["last_message"].as_str().unwrap_or("");
            let is_group = r["is_group"].as_bool().unwrap_or(false);

            let mut entry = format!("[{}] {}", time, chat);
            if is_group { entry += " [群]"; }
            entry += &format!(" ({}条未读)", unread);
            entry += &format!("\n  {}: ", msg_type);
            if !sender.is_empty() {
                entry += &format!("{}: ", sender);
            }
            entry += last_msg;
            println!("{}", entry);
        }
    }
}
