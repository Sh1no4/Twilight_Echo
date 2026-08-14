use tauri::{AppHandle, Manager};
use url::Url;

#[tauri::command]
fn relaunch(app: AppHandle) {
    app.restart();
}

fn allow_external_navigation(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![relaunch])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.on_navigation(|url| {
                    url.scheme() == "tauri" || url.scheme() == "http" || url.scheme() == "https"
                });
            }
            Ok(())
        })
        .on_page_load(|webview, _| {
            let window = webview.window();
            let _ = window.set_title("Twilight Echo");
        })
        .build(tauri::generate_context!())
        .expect("failed to build Twilight Echo")
        .run(|app, event| {
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if allow_external_navigation(&url) {
                        let _ = tauri_plugin_opener::OpenerExt::opener(app).open_url(url.as_str(), None::<&str>);
                    }
                }
            }
        });
}
