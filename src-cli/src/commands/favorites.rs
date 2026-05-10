use crate::contacts::get_contact_names;
use std::collections::HashMap;

const FAV_TYPE_MAP: &[(i64, &str)] = &[
    (1, "文本"), (2, "图片"), (5, "文章"), (19, "名片"), (20, "视频号"),
];

const FAV_TYPE_FILTERS: &[(&str, i64)] = &[
    ("text", 1), ("image", 2), ("article", 5), ("card", 19), ("video", 20),
];

fn parse_fav_content(content: &str, fav_type: i64) -> String {
    if content.is_empty() {
        return String::new();
    }

    // Extract favitem section
    let fav_section: &str = if let Some(start) = content.find("<favitem") {
        let rest = &content[start..];
        if let Some(end) = rest.find("</favitem>") {
            &rest[..end + 10]
        } else { "" }
    } else { content };

    if fav_type == 1 {
        if let Some(d) = fav_section.find("<desc>") {
            let after = &fav_section[d + 6..];
            if let Some(e) = after.find("</desc>") {
                return after[..e].trim().to_string();
            }
        }
        return String::new();
    }
    if fav_type == 2 {
        return "[图片收藏]".to_string();
    }
    if fav_type == 5 {
        let fav_title = if let Some(d) = fav_section.find("<pagetitle>") {
            let after = &fav_section[d + 11..];
            after.find("</pagetitle>").map(|e| after[..e].trim().to_string()).unwrap_or_default()
        } else { String::new() };
        let fav_desc = if let Some(d) = fav_section.find("<pagedesc>") {
            let after = &fav_section[d + 10..];
            after.find("</pagedesc>").map(|e| after[..e].trim().to_string()).unwrap_or_default()
        } else { String::new() };
        return if !fav_desc.is_empty() { format!("{} - {}", fav_title, fav_desc) } else { fav_title };
    }
    if fav_type == 19 {
        if let Some(d) = fav_section.find("<desc>") {
            let after = &fav_section[d + 6..];
            if let Some(e) = after.find("</desc>") {
                return after[..e].trim().to_string();
            }
        }
        return String::new();
    }
    if fav_type == 20 {
        let nickname = if let Some(d) = fav_section.find("<nickname>") {
            let after = &fav_section[d + 10..];
            after.find("</nickname>").map(|e| after[..e].trim().to_string()).unwrap_or_default()
        } else { String::new() };
        let desc = if let Some(d) = fav_section.find("<desc>") {
            let after = &fav_section[d + 6..];
            after.find("</desc>").map(|e| after[..e].trim().to_string()).unwrap_or_default()
        } else { String::new() };
        let parts: Vec<&str> = [nickname.as_str(), desc.as_str()].iter().filter(|s| !s.is_empty()).copied().collect();
        return if parts.is_empty() { "[视频号]".to_string() } else { parts.join(" ") };
    }
    // Default
    if let Some(d) = fav_section.find("<desc>") {
        let after = &fav_section[d + 6..];
        if let Some(e) = after.find("</desc>") {
            return after[..e].trim().to_string();
        }
    }
    "[收藏]".to_string()
}

pub fn run(
    app: &super::AppContext,
    limit: i64,
    fav_type: Option<&str>,
    query: Option<&str>,
    fmt: &str,
) {
    // 查找 favorite.db
    let fav_path = {
        let pre = app.decrypted_dir.join("favorite/favorite.db");
        if pre.exists() {
            pre
        } else {
            match app.cache.borrow_mut().get("favorite/favorite.db") {
                Some(p) => p,
                None => {
                    eprintln!("错误: 无法访问 favorite.db");
                    std::process::exit(3);
                }
            }
        }
    };

    let mut names_map: HashMap<String, String> = HashMap::new();
    let tmp = get_contact_names(&mut app.cache.borrow_mut(), &app.decrypted_dir);
    for (k, v) in tmp {
        names_map.insert(k, v);
    }

    let conn = rusqlite::Connection::open(&fav_path)
        .expect("无法打开 favorite.db");

    let mut where_parts = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ft) = fav_type {
        if let Some((_, type_val)) = FAV_TYPE_FILTERS.iter().find(|(name, _)| *name == ft) {
            where_parts.push("type = ?".to_string());
            params.push(Box::new(*type_val));
        }
    }

    if let Some(q) = query {
        if !q.is_empty() {
            where_parts.push("content LIKE ?".to_string());
            params.push(Box::new(format!("%{}%", q)));
        }
    }

    let where_sql = if where_parts.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_parts.join(" AND "))
    };

    let sql = format!(
        "SELECT local_id, type, update_time, content, fromusr, realchatname \
         FROM fav_db_item {} ORDER BY update_time DESC LIMIT ?1",
        where_sql
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).expect("准备查询失败");
    let rows = stmt.query_map(
        rusqlite::params_from_iter(
            param_refs.iter().chain(std::iter::once(&(&limit as &dyn rusqlite::types::ToSql)))
        ),
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        },
    ).expect("查询收藏失败");

    let mut results = Vec::new();
    for row in rows.flatten() {
        let (local_id, typ, ts, content, fromusr, realchat) = row;
        let from_display = fromusr.as_ref()
            .and_then(|u| names_map.get(u))
            .or(fromusr.as_ref())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let chat_display = realchat.as_ref()
            .and_then(|u| names_map.get(u))
            .or(realchat.as_ref())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let summary = parse_fav_content(&content, typ);
        let type_name = FAV_TYPE_MAP.iter()
            .find(|(id, _)| *id == typ)
            .map(|(_, name)| name.to_string())
            .unwrap_or_else(|| format!("type={}", typ));
        let time_str = chrono::DateTime::from_timestamp(ts, 0)
            .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_default();

        results.push(serde_json::json!({
            "id": local_id,
            "type": type_name,
            "time": time_str,
            "summary": summary,
            "from": from_display,
            "source_chat": chat_display,
        }));
    }

    if fmt == "json" {
        println!("{}", serde_json::to_string_pretty(&serde_json::json!({
            "count": results.len(),
            "favorites": results,
        })).unwrap());
    } else {
        if results.is_empty() {
            println!("没有找到收藏");
            return;
        }
        println!("收藏列表（{} 条）:\n", results.len());
        for r in &results {
            let mut entry = format!("[{}] [{}] {}",
                r["time"].as_str().unwrap_or(""),
                r["type"].as_str().unwrap_or(""),
                r["summary"].as_str().unwrap_or(""),
            );
            let from = r["from"].as_str().filter(|s| !s.is_empty()).unwrap_or("");
            let chat = r["source_chat"].as_str().filter(|s| !s.is_empty()).unwrap_or("");
            if !from.is_empty() {
                entry += &format!("\n  来自: {}", from);
            }
            if !chat.is_empty() {
                entry += &format!("  聊天: {}", chat);
            }
            println!("{}", entry);
        }
    }
}
