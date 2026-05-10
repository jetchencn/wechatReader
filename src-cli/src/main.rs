mod config;
mod crypto;
mod key_utils;
mod db_cache;
mod contacts;
mod messages;
mod keys;
mod formatter;
mod context;
mod commands;

use clap::{Parser, Subcommand, Args};

const VERSION: &str = "0.1.0";

/// WeChat Reader CLI — 查询微信消息、联系人等数据
///
/// 使用示例:
///   wechat-reader init                                # 首次使用：提取密钥
///   wechat-reader sessions                            # 最近会话列表
///   wechat-reader history "张三" --limit 20           # 查看张三的最近 20 条消息
///   wechat-reader search "Claude" --chat "AI交流群"   # 在指定群里搜索关键词
///   wechat-reader contacts --query "李"               # 搜索联系人
///   wechat-reader new-messages                        # 获取增量新消息
#[derive(Parser)]
#[command(name = "wechat-reader", version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// 初始化：提取密钥并生成配置
    Init(InitArgs),
    /// 获取最近会话列表
    Sessions(SessionsArgs),
    /// 获取指定聊天的消息记录
    History(HistoryArgs),
    /// 搜索消息内容
    Search(SearchArgs),
    /// 搜索或列出联系人
    Contacts(ContactsArgs),
    /// 查询群聊成员列表
    Members(MembersArgs),
    /// 获取自上次调用以来的新消息
    NewMessages(NewMessagesArgs),
    /// 导出聊天记录为 markdown 或 txt
    Export(ExportArgs),
    /// 聊天统计分析
    Stats(StatsArgs),
    /// 查看未读会话
    Unread(UnreadArgs),
    /// 查看微信收藏
    Favorites(FavoritesArgs),
}

#[derive(Args)]
struct InitArgs {
    /// 微信数据目录路径（默认自动检测）
    #[arg(long)]
    db_dir: Option<String>,
    /// 强制重新提取密钥
    #[arg(long)]
    force: bool,
}

#[derive(Args)]
struct SessionsArgs {
    /// 返回的会话数量
    #[arg(long, default_value = "20")]
    limit: i64,
    /// 输出格式
    #[arg(long, default_value = "json", value_parser = ["json", "text"])]
    format: String,
}

#[derive(Args)]
struct HistoryArgs {
    /// 聊天名称
    chat_name: String,
    /// 返回的消息数量
    #[arg(long, default_value = "50")]
    limit: i64,
    /// 分页偏移量
    #[arg(long, default_value = "0")]
    offset: i64,
    /// 起始时间 YYYY-MM-DD [HH:MM[:SS]]
    #[arg(long, default_value = "")]
    start_time: String,
    /// 结束时间 YYYY-MM-DD [HH:MM[:SS]]
    #[arg(long, default_value = "")]
    end_time: String,
    /// 输出格式
    #[arg(long, default_value = "json", value_parser = ["json", "text"])]
    format: String,
    /// 消息类型过滤
    #[arg(long, value_parser = ["text", "image", "voice", "video", "sticker", "location", "link", "file", "call", "system"])]
    msg_type: Option<String>,
    /// 解析媒体文件路径
    #[arg(long)]
    media: bool,
}

#[derive(Args)]
struct SearchArgs {
    /// 搜索关键词
    keyword: String,
    /// 限定聊天对象（可多次指定）
    #[arg(long)]
    chat: Vec<String>,
    /// 起始时间
    #[arg(long, default_value = "")]
    start_time: String,
    /// 结束时间
    #[arg(long, default_value = "")]
    end_time: String,
    /// 返回数量
    #[arg(long, default_value = "20")]
    limit: i64,
    /// 分页偏移量
    #[arg(long, default_value = "0")]
    offset: i64,
    /// 输出格式
    #[arg(long, default_value = "json", value_parser = ["json", "text"])]
    format: String,
    /// 消息类型过滤
    #[arg(long, value_parser = ["text", "image", "voice", "video", "sticker", "location", "link", "file", "call", "system"])]
    msg_type: Option<String>,
}

#[derive(Args)]
struct ContactsArgs {
    /// 搜索关键词
    #[arg(long, default_value = "")]
    query: String,
    /// 查看联系人详情
    #[arg(long)]
    detail: Option<String>,
    /// 返回数量
    #[arg(long, default_value = "50")]
    limit: i64,
    /// 输出格式
    #[arg(long, default_value = "json", value_parser = ["json", "text"])]
    format: String,
}

#[derive(Args)]
struct MembersArgs {
    /// 群聊名称
    group_name: String,
    /// 输出格式
    #[arg(long, default_value = "json", value_parser = ["json", "text"])]
    format: String,
}

#[derive(Args)]
struct NewMessagesArgs {
    /// 输出格式
    #[arg(long, default_value = "json", value_parser = ["json", "text"])]
    format: String,
}

#[derive(Args)]
struct ExportArgs {
    /// 聊天名称
    chat_name: String,
    /// 导出格式
    #[arg(long, default_value = "markdown", value_parser = ["markdown", "txt"])]
    format: String,
    /// 输出文件路径
    #[arg(long)]
    output: Option<String>,
    /// 起始时间
    #[arg(long, default_value = "")]
    start_time: String,
    /// 结束时间
    #[arg(long, default_value = "")]
    end_time: String,
    /// 导出消息数量
    #[arg(long, default_value = "500")]
    limit: i64,
}

#[derive(Args)]
struct StatsArgs {
    /// 聊天名称
    chat_name: String,
    /// 起始时间
    #[arg(long, default_value = "")]
    start_time: String,
    /// 结束时间
    #[arg(long, default_value = "")]
    end_time: String,
    /// 输出格式
    #[arg(long, default_value = "json", value_parser = ["json", "text"])]
    format: String,
}

#[derive(Args)]
struct UnreadArgs {
    /// 返回的会话数量
    #[arg(long, default_value = "50")]
    limit: i64,
    /// 输出格式
    #[arg(long, default_value = "json", value_parser = ["json", "text"])]
    format: String,
}

#[derive(Args)]
struct FavoritesArgs {
    /// 返回数量
    #[arg(long, default_value = "20")]
    limit: i64,
    /// 按类型过滤
    #[arg(long, value_parser = ["text", "image", "article", "card", "video"])]
    fav_type: Option<String>,
    /// 关键词搜索
    #[arg(long)]
    query: Option<String>,
    /// 输出格式
    #[arg(long, default_value = "json", value_parser = ["json", "text"])]
    format: String,
}

use context::AppContext;

fn main() {
    let cli = Cli::parse();

    match &cli.command {
        Commands::Init(args) => {
            commands::init::run(args.db_dir.as_deref(), args.force);
        }
        Commands::Sessions(args) => {
            let app = AppContext::new(None).unwrap_or_else(|e| {
                eprintln!("{}", e);
                std::process::exit(1);
            });
            commands::sessions::run(&app, args.limit, &args.format);
        }
        Commands::History(args) => {
            let app = AppContext::new(None).unwrap_or_else(|e| {
                eprintln!("{}", e);
                std::process::exit(1);
            });
            commands::history::run(
                &app, &args.chat_name, args.limit, args.offset,
                &args.start_time, &args.end_time, &args.format,
                args.msg_type.as_deref(), args.media,
            );
        }
        Commands::Search(args) => {
            let app = AppContext::new(None).unwrap_or_else(|e| {
                eprintln!("{}", e);
                std::process::exit(1);
            });
            commands::search::run(
                &app, &args.keyword, &args.chat,
                &args.start_time, &args.end_time,
                args.limit, args.offset, &args.format,
                args.msg_type.as_deref(),
            );
        }
        Commands::Contacts(args) => {
            let app = AppContext::new(None).unwrap_or_else(|e| {
                eprintln!("{}", e);
                std::process::exit(1);
            });
            commands::contacts_cmd::run(
                &app, &args.query, args.detail.as_deref(),
                args.limit, &args.format,
            );
        }
        Commands::Members(args) => {
            let app = AppContext::new(None).unwrap_or_else(|e| {
                eprintln!("{}", e);
                std::process::exit(1);
            });
            commands::members::run(&app, &args.group_name, &args.format);
        }
        Commands::NewMessages(args) => {
            let app = AppContext::new(None).unwrap_or_else(|e| {
                eprintln!("{}", e);
                std::process::exit(1);
            });
            commands::new_messages::run(&app, &args.format);
        }
        Commands::Export(args) => {
            let app = AppContext::new(None).unwrap_or_else(|e| {
                eprintln!("{}", e);
                std::process::exit(1);
            });
            commands::export::run(
                &app, &args.chat_name, &args.format,
                args.output.as_deref(),
                &args.start_time, &args.end_time, args.limit,
            );
        }
        Commands::Stats(args) => {
            let app = AppContext::new(None).unwrap_or_else(|e| {
                eprintln!("{}", e);
                std::process::exit(1);
            });
            commands::stats::run(
                &app, &args.chat_name,
                &args.start_time, &args.end_time, &args.format,
            );
        }
        Commands::Unread(args) => {
            let app = AppContext::new(None).unwrap_or_else(|e| {
                eprintln!("{}", e);
                std::process::exit(1);
            });
            commands::unread::run(&app, args.limit, &args.format);
        }
        Commands::Favorites(args) => {
            let app = AppContext::new(None).unwrap_or_else(|e| {
                eprintln!("{}", e);
                std::process::exit(1);
            });
            commands::favorites::run(
                &app, args.limit, args.fav_type.as_deref(),
                args.query.as_deref(), &args.format,
            );
        }
    }
}
