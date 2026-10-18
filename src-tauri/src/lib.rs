mod db;
mod file;

pub fn run() {
    tauri::Builder::default()
        .manage(db::Sessions::default())
        .invoke_handler(tauri::generate_handler![
            db::db_connect,
            db::db_query,
            db::db_execute,
            db::db_close,
            file::pick_save_path,
            file::pick_open_path,
            file::read_erd_file,
            file::write_erd_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ERD9");
}
