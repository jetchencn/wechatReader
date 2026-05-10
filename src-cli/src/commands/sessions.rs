use crate::contacts::get_contact_names;
use crate::{formatter, messages};
use serde_json::Value;
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
         WHERE last_timestamp > 0 \
         ORDER BY last_timestamp DESC \
         LIMIT ?1"
    ).expect("准备查询失败");

    let rows = stmt.query_map([limit], |row| {
        let username: String = row.get(0)?;
        let unread: Option<i64> = row.get(1)?;
        let summary: Option<Vec<u8>> = row.get(2)?;
        let ts: i64 = row.get(3)?;
        let msg_type: i64 = row.get(4)?;
        let sender: Option<String> = row.get(5)?;
        let sender_name: Option<String> = row.get(6)?;
        Ok((username, unread, summary, ts, msg_type, sender, sender_name))
    }).expect("查询失败");

    let mut results: Vec<Value> = Vec::new();
    for row in rows.flatten() {
        let (username, unread, summary, ts, msg_type, sender, sender_name) = row;
        let display = names_map.get(&username).cloned().unwrap_or_else(|| username.clone());
        let is_group = username.contains("@chatroom");

        let summary_text = summary
            .and_then(|s| {
                if s.len() > 0 && s[0] == 0x28 {
                    // Try zstd decompress
                    let mut dec = zstd::Decoder::new(s.as_slice()).ok()?;
                    let mut text = String::new();
                    std::io::Read::read_to_string(&mut dec, &mut text).ok()?;
                    Some(text)
                } else {
                    String::from_utf8(s).ok()
                }
            })
            .map(|s| {
                if s.contains(":\n") {
                    s.split(":\n").nth(1).unwrap_or(&s).to_string()
                } else {
                    s
                }
            })
            .unwrap_or_default();

        let sender_display = if is_group {
            sender.as_ref()
                .and_then(|s| names_map.get(s))
                .cloned()
                .or_else(|| sender_name.clone())
                .unwrap_or_default()
        } else {
            String::new()
        };

        let time_str = chrono::DateTime::from_timestamp(ts, 0)
            .map(|dt| dt.format("%m-%d %H:%M").to_string())
            .unwrap_or_default();

        results.push(serde_json::json!({
            "chat": display,
            "username": username,
            "is_group": is_group,
            "unread": unread.unwrap_or(0),
            "last_message": summary_text,
            "msg_type": messages::format_msg_type(msg_type),
            "sender": sender_display,
            "timestamp": ts,
            "time": time_str,
        }));
    }

    if fmt == "json" {
        formatter::output_json(&results);
    } else {
        let mut lines = Vec::new();
        for r in &results {
            let chat = r["chat"].as_str().unwrap_or("");
            let time = r["time"].as_str().unwrap_or("");
            let is_group = r["is_group"].as_bool().unwrap_or(false);
            let unread = r["unread"].as_i64().unwrap_or(0);
            let msg_type = r["msg_type"].as_str().unwrap_or("");
            let sender = r["sender"].as_str().unwrap_or("");
            let last_msg = r["last_message"].as_str().unwrap_or("");

            let mut entry = format!("[{}] {}", time, chat);
            if is_group {
                entry += " [群]";
            }
            if unread > 0 {
                entry += &format!(" ({}条未读)", unread);
            }
            entry += &format!("\n  {}: ", msg_type);
            if !sender.is_empty() {
                entry += &format!("{}: ", sender);
            }
            entry += last_msg;
            lines.push(entry);
        }
        println!("最近 {} 个会话:\n", results.len());
        println!("{}", lines.join("\n\n"));
    }
}
