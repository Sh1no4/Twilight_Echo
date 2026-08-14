use tauri::AppHandle;

#[tauri::command]
fn relaunch(app: AppHandle) {
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![relaunch])
        .on_page_load(|webview, _| {
            let window = webview.window();
            let _ = window.set_title("Twilight Echo");
        })
        .build(tauri::generate_context!())
        .expect("failed to build Twilight Echo")
        .run(|_app, _event| {});
}
