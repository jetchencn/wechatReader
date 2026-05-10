use crate::config::{self, auto_detect_db_dir, Config};
use crate::keys;

pub fn run(db_dir: Option<&str>, force: bool) {
    println!("WeChat Reader CLI 初始化");
    println!("{}", "=".repeat(40));

    let keys_file = config::keys_file();
    let config_file = config::config_file();

    // 检查是否已初始化
    if config_file.exists() && keys_file.exists() && !force {
        println!("已初始化（配置: {}）", config_file.display());
        println!("使用 --force 重新提取密钥");
        return;
    }

    // 创建状态目录
    std::fs::create_dir_all(config::state_dir())
        .expect("创建状态目录失败");

    // 确定 db_dir
    let db_dir_str = if let Some(d) = db_dir {
        let p = std::path::Path::new(d);
        if !p.is_dir() {
            eprintln!("[!] 目录不存在: {}", d);
            std::process::exit(1);
        }
        println!("[+] 使用指定数据目录: {}", d);
        p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
            .to_string_lossy().to_string()
    } else {
        match auto_detect_db_dir() {
            Some(d) => {
                println!("[+] 检测到微信数据目录: {}", d);
                d
            }
            None => {
                eprintln!("[!] 未能自动检测到微信数据目录");
                eprintln!("请通过 --db-dir 参数指定，例如:");
                eprintln!("  wechat-reader init --db-dir ~/path/to/db_storage");
                std::process::exit(1);
            }
        }
    };

    // 提取密钥
    println!("\n开始提取密钥...");
    let db_path = std::path::Path::new(&db_dir_str);
    let result = keys::extract_keys_macos(db_path, &keys_file);

    match result {
        Ok(key_map) => {
            let cfg = Config {
                db_dir: db_dir_str,
                ..Config::default()
            };
            cfg.save().expect("保存配置失败");

            println!("\n[+] 初始化完成!");
            println!("    配置: {}", config_file.display());
            println!("    密钥: {}", keys_file.display());
            println!("    提取到 {} 个数据库密钥", key_map.len());
            println!("\n现在可以使用:");
            println!("  wechat-reader sessions");
            println!("  wechat-reader history \"联系人\"");
        }
        Err(e) => {
            eprintln!("\n[!] 密钥提取失败: {}", e);
            std::process::exit(1);
        }
    }
}
