//! ERD 문서 파일(.erd9) 선택, 읽기, 쓰기.
//! 파일 선택은 rfd로 직접 연다. tauri-plugin-dialog는 window.alert/confirm을 비동기 함수로 바꾸므로 사용하지 않는다
//! (화면은 confirm()의 결과를 바로 사용한다).

use std::path::Path;

const FILTER_NAME: &str = "ERD9";
const EXTENSION: &str = "erd9";

/// 저장할 파일 선택. 취소하면 None
#[tauri::command]
pub async fn pick_save_path(window: tauri::WebviewWindow, default_name: String) -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .add_filter(FILTER_NAME, &[EXTENSION])
        .set_file_name(default_name)
        .save_file()
        .await
        .map(|file| file.path().to_string_lossy().into_owned())
}

/// 열 파일 선택. 취소하면 None
#[tauri::command]
pub async fn pick_open_path(window: tauri::WebviewWindow) -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .add_filter(FILTER_NAME, &[EXTENSION])
        .pick_file()
        .await
        .map(|file| file.path().to_string_lossy().into_owned())
}

/// 문서 파일로 읽고 쓸 수 있는 확장자
fn check_extension(path: &str, allowed: &[&str]) -> Result<(), String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if allowed.contains(&ext.as_str()) {
        Ok(())
    } else {
        Err(format!("Not an ERD9 file: {path}"))
    }
}

#[tauri::command]
pub fn read_erd_file(path: String) -> Result<String, String> {
    check_extension(&path, &["erd9", "json"])?;
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))
}

#[tauri::command]
pub fn write_erd_file(path: String, contents: String) -> Result<(), String> {
    check_extension(&path, &["erd9"])?;
    std::fs::write(&path, contents).map_err(|e| format!("Failed to write {path}: {e}"))
}
