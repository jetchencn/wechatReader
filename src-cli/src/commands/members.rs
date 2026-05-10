use crate::contacts::{get_contact_names, get_group_members, resolve_username};

pub fn run(
    app: &super::AppContext,
    group_name: &str,
    fmt: &str,
) {
    let mut cache = app.cache.borrow_mut();
    let username = resolve_username(group_name, &mut cache, &app.decrypted_dir);

    let username = match username {
        Some(u) => u,
        None => {
            eprintln!("找不到: {}", group_name);
            std::process::exit(1);
        }
    };

    if !username.contains("@chatroom") {
        eprintln!("{} 不是一个群聊", group_name);
        std::process::exit(1);
    }

    let names = get_contact_names(&mut cache, &app.decrypted_dir);
    let display_name = names.get(&username).cloned().unwrap_or_else(|| username.clone());

    let result = get_group_members(&username, &mut cache, &app.decrypted_dir);

    if fmt == "json" {
        println!("{}", serde_json::to_string_pretty(&serde_json::json!({
            "group": display_name,
            "username": username,
            "member_count": result.members.len(),
            "owner": result.owner,
            "members": result.members,
        })).unwrap());
    } else {
        let header = format!("{} 的群成员（共 {} 人）", display_name, result.members.len());
        let header = if !result.owner.is_empty() {
            format!("{}，群主: {}", header, result.owner)
        } else {
            header
        };
        println!("{}:\n", header);
        for m in &result.members {
            let mut line = format!("{}  ({})", m.display_name, m.username);
            if !m.remark.is_empty() {
                line += &format!("  备注: {}", m.remark);
            }
            println!("{}", line);
        }
    }
}
