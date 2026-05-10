use serde::Serialize;

/// 输出格式化 — JSON 输出
pub fn output_json<T: Serialize>(data: &T) {
    if let Ok(json) = serde_json::to_string_pretty(data) {
        println!("{}", json);
    }
}

pub fn output_text(text: &str) {
    println!("{}", text);
}
