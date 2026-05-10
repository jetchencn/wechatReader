use crate::contacts::{get_contact_full, get_contact_names, get_contact_detail, resolve_username};

pub fn run(
    app: &super::AppContext,
    query: &str,
    detail: Option<&str>,
    limit: i64,
    fmt: &str,
) {
    if let Some(detail_name) = detail {
        show_detail(app, detail_name, fmt);
        return;
    }

    let names = get_contact_names(&mut app.cache.borrow_mut(), &app.decrypted_dir);
    let full = get_contact_full(&mut app.cache.borrow_mut(), &app.decrypted_dir);

    let matched: Vec<serde_json::Value> = if query.is_empty() {
        full
    } else {
        let q_lower = query.to_lowercase();
        full.into_iter().filter(|c| {
            let nick = c["nick_name"].as_str().unwrap_or("").to_lowercase();
            let remark = c["remark"].as_str().unwrap_or("").to_lowercase();
            let username = c["username"].as_str().unwrap_or("").to_lowercase();
            nick.contains(&q_lower) || remark.contains(&q_lower) || username.contains(&q_lower)
        }).collect()
    };

    let matched: Vec<&serde_json::Value> = matched.iter().take(limit as usize).collect();

    if fmt == "json" {
        println!("{}", serde_json::to_string_pretty(&matched).unwrap());
    } else {
        println!("找到 {} 个联系人:\n", matched.len());
        for c in &matched {
            let display = c["remark"].as_str().filter(|s| !s.is_empty())
                .or_else(|| c["nick_name"].as_str().filter(|s| !s.is_empty()))
                .or_else(|| c["username"].as_str())
                .unwrap_or("");
            let username = c["username"].as_str().unwrap_or("");
            let remark = c["remark"].as_str().filter(|s| !s.is_empty()).unwrap_or("");
            let mut line = format!("{}  ({})", display, username);
            if !remark.is_empty() {
                line += &format!("  备注: {}", remark);
            }
            println!("{}", line);
        }
    }
}

fn show_detail(app: &super::AppContext, name_or_id: &str, fmt: &str) {
    let mut cache = app.cache.borrow_mut();
    let username = resolve_username(name_or_id, &mut cache, &app.decrypted_dir)
        .unwrap_or_else(|| name_or_id.to_string());

    let info = get_contact_detail(&username, &mut cache, &app.decrypted_dir);
    match info {
        Some(info) => {
            if fmt == "json" {
                println!("{}", serde_json::to_string_pretty(&serde_json::json!({
                    "username": info.username,
                    "nick_name": info.nick_name,
                    "remark": info.remark,
                    "alias": info.alias,
                    "description": info.description,
                    "avatar": info.avatar,
                    "verify_flag": info.verify_flag,
                    "local_type": info.local_type,
                    "is_group": info.is_group,
                    "is_subscription": info.is_subscription,
                })).unwrap());
            } else {
                println!("联系人详情: {}", info.nick_name);
                if !info.remark.is_empty() {
                    println!("备注: {}", info.remark);
                }
                if !info.alias.is_empty() {
                    println!("微信号: {}", info.alias);
                }
                println!("wxid: {}", info.username);
                if !info.description.is_empty() {
                    println!("个性签名: {}", info.description);
                }
                if info.is_group {
                    println!("类型: 群聊");
                } else if info.is_subscription {
                    println!("类型: 公众号");
                } else if info.verify_flag >= 8 {
                    println!("类型: 企业认证");
                }
                if !info.avatar.is_empty() {
                    println!("头像: {}", info.avatar);
                }
            }
        }
        None => {
            eprintln!("找不到联系人: {}", name_or_id);
        }
    }
}
