//! Desktop shell for TUNER: Resonance Breaker.
//!
//! The game itself is the web build; this wrapper exists to give it a real
//! window, a native title, and a place to hang platform integrations later
//! (file-backed saves, gamepad rumble, discord-style presence). Keeping the
//! shell this thin means the desktop build cannot drift from the web build.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .expect("error while running TUNER");
}

/// Exposed so the in-game credits and bug reports can name the exact build.
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
