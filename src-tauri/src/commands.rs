use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
pub fn get_app_info() -> Result<AppInfo, String> {
    Ok(AppInfo {
        name: "Wichat Reader".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tauri::command]
pub fn get_data_dir(app: AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file '{}': {}", path, e))
}

#[tauri::command]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, contents).map_err(|e| format!("Failed to write file '{}': {}", path, e))
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for entry in entries {
        if let Ok(entry) = entry {
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            result.push(FileEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
                is_dir: file_type.is_dir(),
                is_file: file_type.is_file(),
            });
        }
    }

    result.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(result)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory '{}': {}", path, e))
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn open_file_dialog(
    app: AppHandle,
    title: Option<String>,
    filters: Option<Vec<FileFilter>>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let builder = app.dialog().file();
    let builder = if let Some(title) = title {
        builder.set_title(&title)
    } else {
        builder
    };

    let builder = if let Some(filters) = filters {
        let mut b = builder;
        for f in filters {
            b = b.add_filter(&f.name, &f.extensions.iter().map(|s| s.as_str()).collect::<Vec<_>>());
        }
        b
    } else {
        builder
    };

    let file_path = builder.blocking_pick_file();
    Ok(file_path.map(|p| p.to_string()))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[tauri::command]
pub async fn save_file_dialog(
    app: AppHandle,
    title: Option<String>,
    default_path: Option<String>,
    filters: Option<Vec<FileFilter>>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let builder = app.dialog().file();
    let builder = if let Some(title) = title {
        builder.set_title(&title)
    } else {
        builder
    };

    let builder = if let Some(default_path) = default_path {
        builder.set_file_name(&default_path)
    } else {
        builder
    };

    let builder = if let Some(filters) = filters {
        let mut b = builder;
        for f in filters {
            b = b.add_filter(&f.name, &f.extensions.iter().map(|s| s.as_str()).collect::<Vec<_>>());
        }
        b
    } else {
        builder
    };

    let file_path = builder.blocking_save_file();
    Ok(file_path.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    opener::open(&url).map_err(|e| format!("Failed to open URL '{}': {}", url, e))
}

#[tauri::command]
pub fn get_env_var(name: String) -> Option<String> {
    std::env::var(&name).ok()
}

/// 运行 wechat-reader CLI 命令
#[tauri::command]
pub fn run_cli(args: Vec<String>) -> Result<String, String> {
    let bin_path = find_wechat_reader_binary()?;

    let output = std::process::Command::new(&bin_path)
        .args(&args)
        .output()
        .map_err(|e| format!("执行 CLI 命令失败: {}", e))?;

    let mut result = String::new();
    if !output.stdout.is_empty() {
        result.push_str(&String::from_utf8_lossy(&output.stdout));
    }
    if !output.stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(&String::from_utf8_lossy(&output.stderr));
    }

    if !output.status.success() {
        return Err(format!("CLI 命令执行失败 (exit code: {}):\n{}",
            output.status.code().unwrap_or(-1), result));
    }

    Ok(result)
}

/// 检查初始化状态（检测 ~/.wechat-reader/config.json 和 all_keys.json）
#[tauri::command]
pub fn check_init_status() -> InitStatus {
    let home = dirs::home_dir();
    let home = match home {
        Some(h) => h,
        None => return InitStatus { initialized: false, config_exists: false, keys_exists: false },
    };
    let state_dir = home.join(".wechat-reader");
    let config_exists = state_dir.join("config.json").exists();
    let keys_exists = state_dir.join("all_keys.json").exists();
    InitStatus {
        initialized: config_exists && keys_exists,
        config_exists,
        keys_exists,
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InitStatus {
    pub initialized: bool,
    pub config_exists: bool,
    pub keys_exists: bool,
}

/// 查找 wechat-reader 二进制路径
fn find_wechat_reader_binary() -> Result<PathBuf, String> {
    // 1. 检查 PATH 环境变量
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join("wechat-reader");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    // 2. 相对于当前可执行文件（Tauri app）
    if let Ok(exe_path) = std::env::current_exe() {
        // Tauri dev: src-tauri/target/debug/wichat-reader
        // CLI: src-cli/target/debug/wechat-reader
        let mut p = exe_path.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf());
        if let Some(ref mut path) = p {
            // 从 target/debug/ -> ../../src-cli/target/debug/wechat-reader
            path.push("src-cli");
            path.push("target");
            path.push(if cfg!(debug_assertions) { "debug" } else { "release" });
            path.push("wechat-reader");
            if path.is_file() {
                return Ok(path.clone());
            }
        }

        // 也尝试从更上层找
        let mut p = exe_path.parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf());
        if let Some(ref mut path) = p {
            path.push("src-cli");
            path.push("target");
            path.push(if cfg!(debug_assertions) { "debug" } else { "release" });
            path.push("wechat-reader");
            if path.is_file() {
                return Ok(path.clone());
            }
        }
    }

    // 3. 在项目常见位置查找
    let cwd_candidates = vec![
        PathBuf::from("src-cli/target/release/wechat-reader"),
        PathBuf::from("src-cli/target/debug/wechat-reader"),
        PathBuf::from("../src-cli/target/release/wechat-reader"),
        PathBuf::from("../src-cli/target/debug/wechat-reader"),
    ];
    for candidate in &cwd_candidates {
        if candidate.is_file() {
            return Ok(candidate.clone());
        }
    }

    Err("找不到 wechat-reader 二进制。请先构建 CLI 工具: cd src-cli && cargo build".to_string())
}
