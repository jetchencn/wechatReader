use std::path::PathBuf;
use std::sync::Mutex;

#[cfg(desktop)]
struct AppState {
    data_dir: Mutex<PathBuf>,
}

mod commands;

fn setup_common_plugins(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        app.handle().plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )?;
    }

    app.handle().plugin(tauri_plugin_dialog::init())?;
    Ok(())
}

fn setup_desktop_plugins(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.handle().plugin(tauri_plugin_process::init())?;
    app.handle().plugin(tauri_plugin_opener::init())?;
    Ok(())
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    setup_common_plugins(app)?;

    #[cfg(desktop)]
    setup_desktop_plugins(app)?;

    #[cfg(desktop)]
    {
        use tauri::Manager;
        let app_data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&app_data_dir)?;
        log::info!("App data directory: {:?}", app_data_dir);
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.manage(AppState {
        data_dir: Mutex::new(PathBuf::new()),
    });

    builder
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_data_dir,
            commands::read_file,
            commands::write_file,
            commands::list_directory,
            commands::file_exists,
            commands::create_directory,
            commands::delete_file,
            commands::open_file_dialog,
            commands::save_file_dialog,
            commands::open_url,
            commands::get_env_var,
            commands::run_cli,
            commands::check_init_status,
        ])
        .setup(setup_app)
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
