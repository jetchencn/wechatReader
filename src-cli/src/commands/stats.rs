use crate::contacts::get_contact_names;
use crate::messages::{parse_time_value, resolve_chat_context};
use std::collections::HashMap;

pub fn run(
    app: &super::AppContext,
    chat_name: &str,
    start_time: &str,
    end_time: &str,
    fmt: &str,
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
        if username.is_empty() { return String::new(); }
        if username == self_username { "me".to_string() }
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

    let result = collect_stats_internal(
        &chat_ctx, &names_map, &display_name_fn, start_ts, end_ts,
    );

    let display_name = chat_ctx["display_name"].as_str().unwrap_or(chat_name);
    let is_group = chat_ctx["is_group"].as_bool().unwrap_or(false);

    if fmt == "json" {
        println!("{}", serde_json::to_string_pretty(&serde_json::json!({
            "chat": display_name,
            "username": chat_ctx["username"],
            "is_group": is_group,
            "total": result.total,
            "type_breakdown": result.type_breakdown,
            "top_senders": result.top_senders,
            "hourly": result.hourly,
        })).unwrap());
    } else {
        let mut lines = vec![format!("{} 聊天统计", display_name)];
        if is_group { lines[0] += " [群聊]"; }
        lines.push(format!("消息总数: {}", result.total));
        if !start_time.is_empty() || !end_time.is_empty() {
            lines.push(format!("时间范围: {} ~ {}",
                if start_time.is_empty() { "最早" } else { start_time },
                if end_time.is_empty() { "最新" } else { end_time }));
        }

        lines.push("\n消息类型分布:".to_string());
        for (t, cnt) in &result.type_breakdown {
            let pct = if result.total > 0 { *cnt as f64 / result.total as f64 * 100.0 } else { 0.0 };
            lines.push(format!("  {}: {} ({:.1}%)", t, cnt, pct));
        }

        if !result.top_senders.is_empty() {
            lines.push("\n发言排行 Top 10:".to_string());
            for s in &result.top_senders {
                lines.push(format!("  {name}: {count}", name = s["name"], count = s["count"]));
            }
        }

        lines.push("\n24小时活跃分布:".to_string());
        let max_count = result.hourly.values().max().copied().unwrap_or(0);
        let bar_max = 30;
        for h in 0..24 {
            let count = result.hourly.get(&h).copied().unwrap_or(0);
            let bar_len = if max_count > 0 { (count as f64 / max_count as f64 * bar_max as f64) as usize } else { 0 };
            let bar = "█".repeat(bar_len);
            lines.push(format!("  {:02}时 |{} {}", h, bar, count));
        }

        println!("{}", lines.join("\n"));
    }
}

#[derive(Debug, serde::Serialize)]
struct StatsResult {
    total: i64,
    type_breakdown: std::collections::BTreeMap<String, i64>,
    top_senders: Vec<serde_json::Value>,
    hourly: std::collections::BTreeMap<i64, i64>,
}

fn do_query_inner(
    db_path: &str, table_name: &str, where_sql: &str, sql_params: &[i64],
    total: &mut i64, type_counts: &mut HashMap<String, i64>,
    type_map: &HashMap<i64, &str>,
) {
    let result: Vec<(i64, i64)> = (|| {
        let conn = rusqlite::Connection::open(db_path).ok()?;
        let sql = format!("SELECT (local_type & 0xFFFFFFFF), COUNT(*) FROM [{}] {} GROUP BY (local_type & 0xFFFFFFFF)", table_name, where_sql);
        let mut stmt = conn.prepare(&sql).ok()?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = sql_params.iter().map(|p| p as &dyn rusqlite::types::ToSql).collect();
        let rows = stmt.query_map(refs.as_slice(), |row| {
            let bt: i64 = row.get(0)?;
            let cnt: i64 = row.get(1)?;
            Ok((bt, cnt))
        }).ok()?;
        Some(rows.flatten().collect::<Vec<_>>())
    })().unwrap_or_default();

    for (bt, cnt) in result {
        let label = type_map.get(&bt).map(|s| *s).unwrap_or("type=?");
        *type_counts.entry(label.to_string()).or_insert(0) += cnt;
        *total += cnt;
    }
}

fn do_sender_query_inner(
    db_path: &str, table_name: &str, where_sql: &str, sql_params: &[i64],
    sender_counts: &mut HashMap<String, i64>,
) {
    let result: Vec<(i64, i64)> = (|| {
        let conn = rusqlite::Connection::open(db_path).ok()?;
        let sql = format!("SELECT real_sender_id, COUNT(*) FROM [{}] {} GROUP BY real_sender_id ORDER BY COUNT(*) DESC LIMIT 20", table_name, where_sql);
        let mut stmt = conn.prepare(&sql).ok()?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = sql_params.iter().map(|p| p as &dyn rusqlite::types::ToSql).collect();
        let rows = stmt.query_map(refs.as_slice(), |row| {
            let sid: i64 = row.get(0)?;
            let cnt: i64 = row.get(1)?;
            Ok((sid, cnt))
        }).ok()?;
        Some(rows.flatten().collect::<Vec<_>>())
    })().unwrap_or_default();

    for (sid, cnt) in result {
        let uname = format!("sender_{}", sid);
        *sender_counts.entry(uname).or_insert(0) += cnt;
    }
}

fn do_hourly_query_inner(
    db_path: &str, table_name: &str, where_sql: &str, sql_params: &[i64],
    hourly_counts: &mut HashMap<i64, i64>,
) {
    let result: Vec<(Option<i64>, i64)> = (|| {
        let conn = rusqlite::Connection::open(db_path).ok()?;
        let sql = format!("SELECT cast(strftime('%H', create_time, 'unixepoch', 'localtime') as integer), COUNT(*) FROM [{}] {} GROUP BY cast(strftime('%H', create_time, 'unixepoch', 'localtime') as integer)", table_name, where_sql);
        let mut stmt = conn.prepare(&sql).ok()?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = sql_params.iter().map(|p| p as &dyn rusqlite::types::ToSql).collect();
        let rows = stmt.query_map(refs.as_slice(), |row| {
            let h: Option<i64> = row.get(0).ok().flatten();
            let cnt: i64 = row.get(1)?;
            Ok((h, cnt))
        }).ok()?;
        Some(rows.flatten().collect::<Vec<_>>())
    })().unwrap_or_default();

    for (h, cnt) in result {
        if let Some(hour) = h {
            *hourly_counts.entry(hour).or_insert(0) += cnt;
        }
    }
}

fn collect_stats_internal(
    ctx: &serde_json::Value,
    names: &HashMap<String, String>,
    display_name_fn: &dyn Fn(&str) -> String,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
) -> StatsResult {
    let type_map: HashMap<i64, &str> = [
        (1, "文本"), (3, "图片"), (34, "语音"), (42, "名片"),
        (43, "视频"), (47, "表情"), (48, "位置"), (49, "链接/文件"),
        (50, "通话"), (10000, "系统"), (10002, "撤回"),
    ].iter().cloned().collect();

    let mut total = 0i64;
    let mut type_counts: HashMap<String, i64> = HashMap::new();
    let mut sender_counts: HashMap<String, i64> = HashMap::new();
    let mut hourly_counts: HashMap<i64, i64> = HashMap::new();

    let tables = ctx["message_tables"].as_array().cloned().unwrap_or_default();
    for table_ctx in &tables {
        let db_path = match table_ctx["db_path"].as_str() {
            Some(p) if !p.is_empty() => p.to_string(),
            _ => continue,
        };
        let table_name = match table_ctx["table_name"].as_str() {
            Some(n) if !n.is_empty() && crate::messages::is_safe_msg_table_name(n) => n.to_string(),
            _ => continue,
        };

        let mut where_parts = Vec::new();
        let mut sql_params: Vec<i64> = Vec::new();
        if let Some(ts) = start_ts {
            where_parts.push("create_time >= ?".to_string());
            sql_params.push(ts);
        }
        if let Some(ts) = end_ts {
            where_parts.push("create_time <= ?".to_string());
            sql_params.push(ts);
        }
        let where_sql = if where_parts.is_empty() { String::new() } else { format!("WHERE {}", where_parts.join(" AND ")) };

        do_query_inner(&db_path, &table_name, &where_sql, &sql_params, &mut total, &mut type_counts, &type_map);
        do_sender_query_inner(&db_path, &table_name, &where_sql, &sql_params, &mut sender_counts);
        do_hourly_query_inner(&db_path, &table_name, &where_sql, &sql_params, &mut hourly_counts);
    } // end for table_ctx

    let mut top_senders: Vec<(String, i64)> = sender_counts.into_iter().collect();
    top_senders.sort_by(|a, b| b.1.cmp(&a.1));
    top_senders.truncate(10);

    let top_senders_json: Vec<serde_json::Value> = top_senders.into_iter().map(|(u, c)| {
        serde_json::json!({"name": display_name_fn(&u), "count": c})
    }).collect();

    let mut hourly = std::collections::BTreeMap::new();
    for h in 0..24 {
        hourly.insert(h, hourly_counts.get(&h).copied().unwrap_or(0));
    }

    let mut type_breakdown_sorted: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    let mut type_vec: Vec<(String, i64)> = type_counts.into_iter().collect();
    type_vec.sort_by(|a, b| b.1.cmp(&a.1));
    for (k, v) in type_vec {
        type_breakdown_sorted.insert(k, v);
    }

    StatsResult {
        total,
        type_breakdown: type_breakdown_sorted,
        top_senders: top_senders_json,
        hourly,
    }
}
