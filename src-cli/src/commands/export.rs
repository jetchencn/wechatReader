use crate::contacts::get_contact_names;
use crate::messages::{collect_chat_history, parse_time_value, resolve_chat_context};
use std::collections::HashMap;

pub fn run(
    app: &super::AppContext,
    chat_name: &str,
    fmt: &str,
    output_path: Option<&str>,
    start_time: &str,
    end_time: &str,
    limit: i64,
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
        if username == self_username { "我".to_string() }
        else { names_map.get(username).cloned().unwrap_or_else(|| username.to_string()) }
    };

    let chat_ctx = resolve_chat_context(
        chat_name, &app.msg_db_keys, &app.keys,
        &mut app.cache.borrow_mut(), &app.decrypted_dir, &app.db_dir,
    );

    let chat_ctx = match chat_ctx {
        Some(c) => c,
        None => {
            eprintln!("找不到聊天对象: {}", chat_name);
            std::process::exit(1);
        }
    };

    let (lines, _failures) = collect_chat_history(
        &chat_ctx, &names_map, &display_name_fn,
        start_ts, end_ts, limit, 0, None, false, None,
    );

    if lines.is_empty() {
        if output_path.is_some() {
            eprintln!("{} 无消息记录", chat_ctx["display_name"].as_str().unwrap_or(chat_name));
        } else {
            println!("{} 无消息记录", chat_ctx["display_name"].as_str().unwrap_or(chat_name));
        }
        return;
    }

    let display_name = chat_ctx["display_name"].as_str().unwrap_or(chat_name);
    let chat_type = if chat_ctx["is_group"].as_bool().unwrap_or(false) { "群聊" } else { "私聊" };
    let time_range = format!("{} ~ {}",
        if start_time.is_empty() { "最早" } else { start_time },
        if end_time.is_empty() { "最新" } else { end_time },
    );
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();

    let content = if fmt == "markdown" {
        format!(
            "# 聊天记录: {}\n\n**时间范围:** {}\n\n**导出时间:** {}\n\n**消息数量:** {}\n\n**类型:** {}\n\n---\n{}",
            display_name, time_range, now, lines.len(), chat_type,
            lines.iter().map(|l| format!("- {}", l)).collect::<Vec<_>>().join("\n"),
        )
    } else {
        format!(
            "聊天记录: {}\n类型: {}\n时间范围: {}\n导出时间: {}\n消息数量: {}\n{}",
            display_name, chat_type, time_range, now, lines.len(),
            "=".repeat(60),
        ) + "\n" + &lines.join("\n")
    };

    if let Some(path) = output_path {
        std::fs::write(path, &content).unwrap_or_else(|e| {
            eprintln!("写入文件失败: {}", e);
        });
        eprintln!("已导出到: {}（{} 条消息）", path, lines.len());
    } else {
        println!("{}", content);
    }
}
