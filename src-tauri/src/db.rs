//! 데이터베이스 연결 (Forward / Reverse engineering, Compare and Merge).
//! SQL 생성과 스키마 해석은 프런트엔드(TypeScript)에서 하고, 여기서는 연결, 조회, 실행만 담당한다.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::mysql::{MySqlConnectOptions, MySqlConnection, MySqlRow};
use sqlx::postgres::{PgConnectOptions, PgConnection, PgRow};
use sqlx::{Column as _, ConnectOptions, Connection as _, Executor as _, Row as _};
use tauri::State;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectConfig {
    dbms: String,
    host: String,
    port: u16,
    user: String,
    password: String,
    /// MariaDB/PostgreSQL/MS-SQL: 데이터베이스, Oracle: 서비스 이름
    database: String,
    /// MS-SQL: 서버 인증서를 확인하지 않음 (자체 서명 인증서)
    #[serde(default)]
    trust_cert: bool,
}

#[derive(Serialize)]
pub struct QueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
}

type MsSqlClient = tiberius::Client<Compat<TcpStream>>;

enum Conn {
    MySql(MySqlConnection),
    Pg(PgConnection),
    MsSql(MsSqlClient),
    #[cfg(feature = "oracle")]
    Oracle(Arc<std::sync::Mutex<oracle::Connection>>),
}

#[derive(Default)]
pub struct Sessions {
    next: AtomicU32,
    map: Mutex<HashMap<u32, Arc<Mutex<Conn>>>>,
}

impl Sessions {
    async fn get(&self, id: u32) -> Result<Arc<Mutex<Conn>>, String> {
        self.map.lock().await.get(&id).cloned().ok_or_else(|| "The connection is closed.".to_string())
    }
}

fn err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

async fn with_timeout<T, F: std::future::Future<Output = Result<T, String>>>(future: F) -> Result<T, String> {
    tokio::time::timeout(CONNECT_TIMEOUT, future).await.map_err(|_| "Connection timed out.".to_string())?
}

async fn open(config: ConnectConfig) -> Result<Conn, String> {
    match config.dbms.as_str() {
        "mariadb" => {
            let mut options = MySqlConnectOptions::new()
                .host(&config.host).port(config.port).username(&config.user).password(&config.password);
            if !config.database.is_empty() {
                options = options.database(&config.database);
            }
            Ok(Conn::MySql(with_timeout(async { options.connect().await.map_err(err) }).await?))
        }
        "postgresql" => {
            let mut options = PgConnectOptions::new()
                .host(&config.host).port(config.port).username(&config.user).password(&config.password);
            if !config.database.is_empty() {
                options = options.database(&config.database);
            }
            Ok(Conn::Pg(with_timeout(async { options.connect().await.map_err(err) }).await?))
        }
        "mssql" => {
            let mut options = tiberius::Config::new();
            options.host(&config.host);
            options.port(config.port);
            options.authentication(tiberius::AuthMethod::sql_server(&config.user, &config.password));
            if !config.database.is_empty() {
                options.database(&config.database);
            }
            if config.trust_cert {
                options.trust_cert();
            }
            let client = with_timeout(async {
                let tcp = TcpStream::connect(options.get_addr()).await.map_err(err)?;
                tcp.set_nodelay(true).map_err(err)?;
                tiberius::Client::connect(options, tcp.compat_write()).await.map_err(err)
            }).await?;
            Ok(Conn::MsSql(client))
        }
        #[cfg(feature = "oracle")]
        "oracle" => {
            let connect_string = format!("//{}:{}/{}", config.host, config.port, config.database);
            let conn = tauri::async_runtime::spawn_blocking(move || {
                let mut conn = oracle::Connection::connect(&config.user, &config.password, &connect_string).map_err(err)?;
                conn.set_autocommit(true);
                Ok::<_, String>(conn)
            }).await.map_err(err)??;
            Ok(Conn::Oracle(Arc::new(std::sync::Mutex::new(conn))))
        }
        other => Err(format!("Unsupported DBMS: {other}")),
    }
}

/* -----------------------------------------------------------------------------------
 * 조회 결과를 JSON 값으로. 메타데이터 조회는 대부분 문자열과 숫자이므로 그 외 타입은 문자열로 처리
 */
fn opt<T: Into<Value>>(value: Option<T>) -> Value {
    value.map(Into::into).unwrap_or(Value::Null)
}

macro_rules! try_types {
    ($row:expr, $i:expr, $($t:ty),*) => {
        $( if let Ok(v) = $row.try_get::<Option<$t>, _>($i) { return opt(v); } )*
    };
}

fn mysql_value(row: &MySqlRow, i: usize) -> Value {
    try_types!(row, i, String, i64, u64, f64);
    if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
        return opt(v.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()));
    }
    // DECIMAL 등은 문자열로 전송된다
    row.try_get_unchecked::<Option<String>, _>(i).map(opt).unwrap_or(Value::Null)
}

fn pg_value(row: &PgRow, i: usize) -> Value {
    try_types!(row, i, String, i16, i32, i64, f32, f64, bool);
    // 도메인 타입(information_schema.sql_identifier 등)은 문자열
    row.try_get_unchecked::<Option<String>, _>(i).map(opt).unwrap_or(Value::Null)
}

fn mssql_value(data: tiberius::ColumnData<'static>) -> Value {
    use tiberius::ColumnData as D;
    match data {
        D::U8(v) => opt(v),
        D::I16(v) => opt(v),
        D::I32(v) => opt(v),
        D::I64(v) => opt(v),
        D::F32(v) => opt(v),
        D::F64(v) => opt(v),
        D::Bit(v) => opt(v),
        D::String(v) => opt(v.map(|s| s.into_owned())),
        D::Guid(v) => opt(v.map(|g| g.to_string())),
        D::Numeric(v) => opt(v.map(|n| n.to_string())),
        D::Binary(v) => opt(v.map(|b| String::from_utf8_lossy(&b).into_owned())),
        _ => Value::Null,
    }
}

fn rows_to_result<R: sqlx::Row>(rows: &[R], value: fn(&R, usize) -> Value) -> QueryResult {
    let columns = rows.first().map(|row| row.columns().iter().map(|c| c.name().to_string()).collect()).unwrap_or_default();
    let rows = rows.iter().map(|row| (0..row.len()).map(|i| value(row, i)).collect()).collect();
    QueryResult { columns, rows }
}

async fn query(conn: &mut Conn, sql: String) -> Result<QueryResult, String> {
    match conn {
        // 인자 없는 &str은 텍스트 프로토콜로 실행된다
        Conn::MySql(c) => Ok(rows_to_result(&c.fetch_all(sql.as_str()).await.map_err(err)?, mysql_value)),
        Conn::Pg(c) => Ok(rows_to_result(&c.fetch_all(sql.as_str()).await.map_err(err)?, pg_value)),
        Conn::MsSql(c) => {
            let rows = c.simple_query(sql).await.map_err(err)?.into_first_result().await.map_err(err)?;
            let columns = rows.first().map(|row| row.columns().iter().map(|c| c.name().to_string()).collect()).unwrap_or_default();
            let rows = rows.into_iter().map(|row| row.into_iter().map(mssql_value).collect()).collect();
            Ok(QueryResult { columns, rows })
        }
        #[cfg(feature = "oracle")]
        Conn::Oracle(c) => {
            let c = c.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let conn = c.lock().map_err(err)?;
                let result = conn.query(&sql, &[]).map_err(err)?;
                let columns: Vec<String> = result.column_info().iter().map(|c| c.name().to_string()).collect();
                let mut rows = Vec::new();
                for row in result {
                    let row = row.map_err(err)?;
                    let values = (0..columns.len())
                        .map(|i| row.get::<usize, Option<String>>(i).map(opt).unwrap_or(Value::Null))
                        .collect();
                    rows.push(values);
                }
                Ok(QueryResult { columns, rows })
            }).await.map_err(err)?
        }
    }
}

async fn execute(conn: &mut Conn, sql: String) -> Result<u64, String> {
    match conn {
        // 텍스트 프로토콜: Prepared Statement로 실행할 수 없는 DDL이 있음
        Conn::MySql(c) => Ok(c.execute(sql.as_str()).await.map_err(err)?.rows_affected()),
        Conn::Pg(c) => Ok(c.execute(sql.as_str()).await.map_err(err)?.rows_affected()),
        Conn::MsSql(c) => Ok(c.execute(sql, &[]).await.map_err(err)?.total()),
        #[cfg(feature = "oracle")]
        Conn::Oracle(c) => {
            let c = c.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let conn = c.lock().map_err(err)?;
                let statement = conn.execute(&sql, &[]).map_err(err)?;
                statement.row_count().map_err(err)
            }).await.map_err(err)?
        }
    }
}

/* -----------------------------------------------------------------------------------
 * commands
 */
#[tauri::command]
pub async fn db_connect(sessions: State<'_, Sessions>, config: ConnectConfig) -> Result<u32, String> {
    let conn = open(config).await?;
    let id = sessions.next.fetch_add(1, Ordering::Relaxed) + 1;
    sessions.map.lock().await.insert(id, Arc::new(Mutex::new(conn)));
    Ok(id)
}

#[tauri::command]
pub async fn db_query(sessions: State<'_, Sessions>, session: u32, sql: String) -> Result<QueryResult, String> {
    let conn = sessions.get(session).await?;
    let mut conn = conn.lock().await;
    query(&mut conn, sql).await
}

#[tauri::command]
pub async fn db_execute(sessions: State<'_, Sessions>, session: u32, sql: String) -> Result<u64, String> {
    let conn = sessions.get(session).await?;
    let mut conn = conn.lock().await;
    execute(&mut conn, sql).await
}

#[tauri::command]
pub async fn db_close(sessions: State<'_, Sessions>, session: u32) -> Result<(), String> {
    let conn = sessions.map.lock().await.remove(&session);
    if let Some(conn) = conn {
        if let Ok(conn) = Arc::try_unwrap(conn) {
            match conn.into_inner() {
                Conn::MySql(c) => { let _ = c.close().await; }
                Conn::Pg(c) => { let _ = c.close().await; }
                Conn::MsSql(c) => { let _ = c.close().await; }
                #[cfg(feature = "oracle")]
                Conn::Oracle(_) => {}
            }
        }
    }
    Ok(())
}
