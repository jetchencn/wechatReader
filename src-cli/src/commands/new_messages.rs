use crate::config;
use crate::contacts::get_contact_names;
use crate::messages::format_msg_type;
use serde_json::Value;
use std::collections::HashMap;

pub fn run(
    app: &super::AppContext,
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
         ORDER BY last_timestamp DESC"
    ).expect("准备查询失败");

    let rows: Vec<(
        String, Option<i64>, Option<Vec<u8>>, i64, i64,
        Option<String>, Option<String>,
    )> = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<i64>>(1)?,
            row.get::<_, Option<Vec<u8>>>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
        ))
    }).expect("查询失败").filter_map(|r| r.ok()).collect();

    // 加载上次检查状态
    let last_state: HashMap<String, i64> = {
        let f = config::last_check_file();
        if f.exists() {
            std::fs::read_to_string(&f).ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            HashMap::new()
        }
    };

    let curr_state: HashMap<String, i64> = rows.iter().map(|(u, _, _, ts, _, _, _)| {
        (u.clone(), *ts)
    }).collect();

    if last_state.is_empty() {
        // 首次调用：保存状态，返回未读
        save_last_state(&curr_state);
        let unread_msgs: Vec<Value> = rows.iter().filter(|(_, unread, _, _, _, _, _)| {
            unread.unwrap_or(0) > 0
        }).map(|(username, unread, summary, ts, msg_type, sender, sender_name)| {
            let display = names_map.get(username).cloned().unwrap_or_else(|| username.clone());
            let is_group = username.contains("@chatroom");
            let summary_text = summary.as_ref()
                .and_then(|s| String::from_utf8(s.clone()).ok())
                .map(|s| if s.contains(":\n") { s.split(":\n").nth(1).unwrap_or(&s).to_string() } else { s })
                .unwrap_or_default();
            let time_str = chrono::DateTime::from_timestamp(*ts, 0)
                .map(|dt| dt.format("%H:%M").to_string())
                .unwrap_or_default();
            serde_json::json!({
                "chat": display,
                "username": username,
                "is_group": is_group,
                "unread": unread.unwrap_or(0),
                "last_message": summary_text,
                "msg_type": format_msg_type(*msg_type),
                "time": time_str,
                "timestamp": ts,
            })
        }).collect();

        if fmt == "json" {
            println!("{}", serde_json::to_string_pretty(&serde_json::json!({
                "first_call": true,
                "unread_count": unread_msgs.len(),
                "messages": unread_msgs,
            })).unwrap());
        } else {
            if unread_msgs.is_empty() {
                println!("当前无未读消息（已记录状态，下次调用将返回新消息）");
            } else {
                println!("当前 {} 个未读会话:\n", unread_msgs.len());
                for m in &unread_msgs {
                    let tag = if m["is_group"].as_bool().unwrap_or(false) { " [群]" } else { "" };
                    println!("[{}] {}{} ({}条未读): {}",
                        m["time"].as_str().unwrap_or(""),
                        m["chat"].as_str().unwrap_or(""),
                        tag,
                        m["unread"].as_i64().unwrap_or(0),
                        m["last_message"].as_str().unwrap_or(""),
                    );
                }
            }
        }
        return;
    }

    // 后续调用：对比差异
    let new_msgs: Vec<Value> = rows.iter().filter(|(username, _, _, ts, _, _, _)| {
        let prev = last_state.get(username).copied().unwrap_or(0);
        *ts > prev
    }).map(|(username, _, summary, ts, msg_type, sender, sender_name)| {
        let display = names_map.get(username).cloned().unwrap_or_else(|| username.clone());
        let is_group = username.contains("@chatroom");
        let summary_text = summary.as_ref()
            .and_then(|s| String::from_utf8(s.clone()).ok())
            .map(|s| if s.contains(":\n") { s.split(":\n").nth(1).unwrap_or(&s).to_string() } else { s })
            .unwrap_or_default();
        let sender_display = if is_group {
            sender.as_ref()
                .and_then(|s| names_map.get(s))
                .cloned()
                .or_else(|| sender_name.clone())
                .unwrap_or_default()
        } else { String::new() };
        let time_str = chrono::DateTime::from_timestamp(*ts, 0)
            .map(|dt| dt.format("%H:%M:%S").to_string())
            .unwrap_or_default();
        serde_json::json!({
            "chat": display,
            "username": username,
            "is_group": is_group,
            "last_message": summary_text,
            "msg_type": format_msg_type(*msg_type),
            "sender": sender_display,
            "time": time_str,
            "timestamp": ts,
        })
    }).collect();

    save_last_state(&curr_state);

    let mut sorted_msgs = new_msgs.clone();
    sorted_msgs.sort_by(|a, b| {
        a["timestamp"].as_i64().unwrap_or(0).cmp(&b["timestamp"].as_i64().unwrap_or(0))
    });

    if fmt == "json" {
        println!("{}", serde_json::to_string_pretty(&serde_json::json!({
            "first_call": false,
            "new_count": sorted_msgs.len(),
            "messages": sorted_msgs,
        })).unwrap());
    } else {
        if sorted_msgs.is_empty() {
            println!("无新消息");
        } else {
            println!("{} 条新消息:\n", sorted_msgs.len());
            for m in &sorted_msgs {
                let tag = if m["is_group"].as_bool().unwrap_or(false) { " [群]" } else { "" };
                let sender = m["sender"].as_str().filter(|s| !s.is_empty()).unwrap_or("");
                let mut entry = format!("[{}] {}{}: {}",
                    m["time"].as_str().unwrap_or(""),
                    m["chat"].as_str().unwrap_or(""),
                    tag,
                    m["msg_type"].as_str().unwrap_or(""),
                );
                if !sender.is_empty() {
                    entry += &format!(" ({})", sender);
                }
                entry += &format!(" - {}", m["last_message"].as_str().unwrap_or(""));
                println!("{}", entry);
            }
        }
    }
}

fn save_last_state(state: &HashMap<String, i64>) {
    let dir = config::state_dir();
    std::fs::create_dir_all(&dir).ok();
    if let Ok(content) = serde_json::to_string(state) {
        std::fs::write(config::last_check_file(), content).ok();
    }
}
