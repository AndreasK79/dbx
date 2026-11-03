//! Native ODBC driver.
//!
//! Connects with a raw ODBC connection string (either `DSN=...` referencing an
//! configured data source or a driver-based string such as
//! `Driver={Adaptive Server Enterprise};Server=host,5000;Database=pubs2`), so
//! any database with an ODBC driver — Sybase ASE being the motivating case —
//! can be browsed and queried without a dedicated Rust driver.
//!
//! Metadata comes exclusively from the ODBC catalog functions (SQLTables /
//! SQLColumns / SQLPrimaryKeys / SQLForeignKeys), which are driver independent
//! and therefore safe for any dialect. Query cancellation is a best-effort
//! `SQLCancel` on the statement handle registered with the query executor.
//!
//! Windows only: the OS ships odbc32.dll and the vendor drivers are Windows
//! binaries. Non-Windows builds get stubs so the pool dispatch still compiles.

#[cfg(windows)]
mod imp {
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use odbc_api::handles::{AsStatementRef, Statement};
    use odbc_api::parameter::VarCharArray;
    use odbc_api::{
        environment, sys, Connection, ConnectionOptions, Cursor, DataType, ResultSetMetadata,
        escape_attribute_value,
    };

    use crate::execution::MAX_ROWS;
    use crate::models::connection::ConnectionConfig;
    use crate::types::{
        ColumnInfo, DatabaseInfo, ForeignKeyInfo, IndexInfo, ObjectInfo, ObjectSource,
        ObjectSourceKind, QueryResult, TableInfo, TriggerInfo,
    };

    /// Statement handle shared with the cancellation thread. `HStmt` is a raw
    /// pointer, which is fine to move across threads for the documented
    /// cross-thread `SQLCancel` pattern: the slot holding it is always cleared
    /// before the owning statement is dropped, so a value observed here is
    /// always a live handle.
    #[derive(Clone, Copy)]
    struct CancelHandle(sys::HStmt);

    unsafe impl Send for CancelHandle {}
    unsafe impl Sync for CancelHandle {}

    /// A single ODBC session shared by all queries of a connection. ODBC
    /// connection handles are not safe for concurrent use, so queries
    /// serialize on the mutex, mirroring the SqlServer single-session model.
    #[derive(Clone)]
    pub struct OdbcClient {
        conn: Arc<Mutex<Connection<'static>>>,
        /// Statement handle of the query currently executing, published so the
        /// query executor can request a best-effort `SQLCancel` from the
        /// cancellation thread. Queries serialize on `conn`, so one slot is
        /// enough; it is always cleared before the statement is freed.
        active_statement: Arc<Mutex<Option<CancelHandle>>>,
        /// Statement timeout (SQL_ATTR_QUERY_TIMEOUT) applied to every query.
        query_timeout_sec: Option<usize>,
        /// `DATABASE=` attribute captured from the connection string. Some
        /// drivers (Sybase ASE) reject the null-pointer probe
        /// `SQLGetConnectAttr` uses for SQL_ATTR_CURRENT_CATALOG (HY009), so
        /// this is the fallback label for the database list.
        default_catalog: Option<String>,
    }

    impl OdbcClient {
        /// A closure for the query executor's cancellation registry; calls
        /// `SQLCancel` on the statement currently executing, if any.
        pub fn cancel_interrupt(&self) -> impl Fn() + Send + 'static {
            let slot = self.active_statement.clone();
            move || {
                if let Ok(active) = slot.lock() {
                    if let Some(statement) = *active {
                        // Cross-thread cancellation is the documented purpose
                        // of SQLCancel; the slot is cleared before the
                        // statement is dropped, so the handle is valid here.
                        // The return code is ignored on purpose: cancel is
                        // best-effort and the statement may already be done.
                        let _ = unsafe { sys::SQLCancel(statement.0) };
                    }
                }
            }
        }
    }

    /// Appends `UID=`/`PWD=` for credentials entered in the connection form
    /// unless the connection string already carries them. `PWD` is escaped
    /// with the ODBC rules (wrapped in `{}` when it contains `;` or `}`).
    fn compose_connection_string(base: &str, username: &str, password: &str) -> String {
        let mut composed = base.trim().trim_end_matches(';').to_string();
        if !username.trim().is_empty() && !has_attribute(&composed, "UID") {
            composed.push_str(&format!(";UID={}", escape_attribute_value(username.trim())));
        }
        if !password.is_empty() && !has_attribute(&composed, "PWD") {
            composed.push_str(&format!(";PWD={}", escape_attribute_value(password)));
        }
        composed
    }

    /// Whether `key=VALUE` is already present in the connection string.
    /// Segments are split on `;` outside `{}` braces so driver names such as
    /// `{a;b}` do not confuse the scan.
    fn has_attribute(connection_string: &str, key: &str) -> bool {
        let mut depth = 0usize;
        let mut segment_start = 0usize;
        let bytes = connection_string.as_bytes();
        for (index, byte) in bytes.iter().enumerate() {
            match byte {
                b'{' => depth += 1,
                b'}' => depth = depth.saturating_sub(1),
                b';' if depth == 0 => {
                    if segment_has_key(&connection_string[segment_start..index], key) {
                        return true;
                    }
                    segment_start = index + 1;
                }
                _ => {}
            }
        }
        segment_has_key(&connection_string[segment_start..], key)
    }

    fn segment_has_key(segment: &str, key: &str) -> bool {
        segment
            .split_once('=')
            .is_some_and(|(name, _)| name.trim().eq_ignore_ascii_case(key))
    }

    /// Value of `KEY=value` in a connection string, surrounding braces
    /// stripped; `None` when the attribute is absent or empty. Brace-aware
    /// like [`has_attribute`].
    fn attribute_value(connection_string: &str, key: &str) -> Option<String> {
        let mut depth = 0usize;
        let mut segment_start = 0usize;
        let bytes = connection_string.as_bytes();
        for (index, byte) in bytes.iter().enumerate() {
            match byte {
                b'{' => depth += 1,
                b'}' => depth = depth.saturating_sub(1),
                b';' if depth == 0 => {
                    if let Some(value) = segment_value(&connection_string[segment_start..index], key) {
                        return Some(value);
                    }
                    segment_start = index + 1;
                }
                _ => {}
            }
        }
        segment_value(&connection_string[segment_start..], key)
    }

    fn segment_value(segment: &str, key: &str) -> Option<String> {
        let (name, value) = segment.split_once('=')?;
        if !name.trim().eq_ignore_ascii_case(key) {
            return None;
        }
        let value = value.trim();
        let value = value.strip_prefix('{').unwrap_or(value);
        let value = value.strip_suffix('}').unwrap_or(value);
        let value = value.trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    }

    pub fn connect(
        connection_string: &str,
        username: &str,
        password: &str,
        connect_timeout: Duration,
        query_timeout_sec: Option<usize>,
    ) -> Result<OdbcClient, String> {
        let composed = compose_connection_string(connection_string, username, password);
        if composed.trim().is_empty() {
            return Err("ODBC connection string is empty".to_string());
        }
        let env = environment().map_err(|e| format!("ODBC environment init failed: {e}"))?;
        let options = ConnectionOptions {
            login_timeout_sec: Some(connect_timeout.as_secs().clamp(1, 3600) as u32),
            packet_size: None,
        };
        let conn = env
            .connect_with_connection_string(&composed, options)
            .map_err(|e| format!("ODBC connection failed: {e}"))?;
        let default_catalog = attribute_value(&composed, "DATABASE");
        Ok(OdbcClient {
            conn: Arc::new(Mutex::new(conn)),
            active_statement: Arc::new(Mutex::new(None)),
            query_timeout_sec,
            default_catalog,
        })
    }

    /// Builds a client straight from the saved connection config. The
    /// connection string is the endpoint (`DSN=...` or a driver-based
    /// string); username/password from the form are appended as UID=/PWD=
    /// when the string does not carry them. A `query_timeout_secs` of 0
    /// means "no server-side statement timeout".
    pub fn connect_from_config(
        config: &ConnectionConfig,
        connect_timeout: Duration,
    ) -> Result<OdbcClient, String> {
        let connection_string = config
            .connection_string
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "ODBC connections need a connection string (DSN=... or Driver=...)".to_string())?;
        let query_timeout_secs = if config.query_timeout_secs == 0 {
            None
        } else {
            Some(config.query_timeout_secs as usize)
        };
        connect(
            connection_string,
            &config.username,
            &config.password,
            connect_timeout,
            query_timeout_secs,
        )
    }

    fn lock_conn(client: &OdbcClient) -> Result<std::sync::MutexGuard<'_, Connection<'static>>, String> {
        client.conn.lock().map_err(|_| "ODBC connection lock poisoned".to_string())
    }

    fn lock_active(client: &OdbcClient) -> Result<std::sync::MutexGuard<'_, Option<CancelHandle>>, String> {
        client.active_statement.lock().map_err(|_| "ODBC cancel slot lock poisoned".to_string())
    }

    /// Round-trips the cheapest driver-independent statement (a SQLTables
    /// catalog call with no filters) to prove the session talks to the server.
    pub async fn test_connection(client: &OdbcClient, _timeout: Duration) -> Result<(), String> {
        let client = client.clone();
        tokio::task::spawn_blocking(move || {
            let conn = lock_conn(&client)?;
            let _ = conn.tables("", "", "", "").map_err(odbc_error)?;
            Ok(())
        })
        .await
        .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    /// Reports a dead session so the pool layer can reconnect; used by the
    /// keepalive probe.
    pub async fn health_check(client: &OdbcClient) -> Result<(), String> {
        let client = client.clone();
        tokio::task::spawn_blocking(move || {
            let conn = lock_conn(&client)?;
            match conn.is_dead().map_err(odbc_error)? {
                false => Ok(()),
                true => Err("ODBC connection is dead".to_string()),
            }
        })
        .await
        .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    pub async fn list_databases(client: &OdbcClient) -> Result<Vec<DatabaseInfo>, String> {
        let client = client.clone();
        tokio::task::spawn_blocking(move || {
            let conn = lock_conn(&client)?;
            // The ODBC catalog plays the "database" role (the ASE database,
            // the SQL Server database, the Excel file). One session reaches
            // exactly one catalog, so report the current one. Some drivers
            // (Sybase ASE) reject the null-pointer probe SQLGetConnectAttr
            // uses to size the catalog buffer (HY009), so treat a failed
            // read as "unknown" and fall back to the DATABASE= attribute
            // captured at connect, then a neutral label — never fail the
            // whole database list over it.
            let name = conn
                .current_catalog()
                .ok()
                .filter(|value| !value.is_empty())
                .or_else(|| client.default_catalog.clone())
                .unwrap_or_else(|| "catalog".to_string());
            Ok(vec![DatabaseInfo { name, ..Default::default() }])
        })
        .await
        .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    pub async fn list_schemas(client: &OdbcClient) -> Result<Vec<String>, String> {
        let client = client.clone();
        tokio::task::spawn_blocking(move || {
            let conn = lock_conn(&client)?;
            // Per SQLTables contract: schema "%" with empty table and type
            // lists the data source's schema names.
            let mut schemas: Vec<String> = Vec::new();
            for row in conn.tables("", "%", "", "").map_err(odbc_error)? {
                let row = row.map_err(odbc_error)?;
                let schema = cell_text(&row.schema);
                if !schema.is_empty() && !schemas.contains(&schema) {
                    schemas.push(schema);
                }
            }
            schemas.sort_by_key(|schema| schema.to_lowercase());
            Ok(schemas)
        })
        .await
        .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    pub async fn list_tables(client: &OdbcClient, schema: &str) -> Result<Vec<TableInfo>, String> {
        let client = client.clone();
        let schema = schema.to_string();
        tokio::task::spawn_blocking(move || {
            let conn = lock_conn(&client)?;
            let schema_filter = if schema.is_empty() { "%".to_string() } else { schema };
            // Empty type list asks for every kind; SYNONYM/ALIAS rows are
            // skipped when classifying.
            let mut tables = Vec::new();
            for row in conn.tables("", &schema_filter, "%", "").map_err(odbc_error)? {
                let row = row.map_err(odbc_error)?;
                let table_type = cell_text(&row.table_type).to_ascii_uppercase();
                let table_type = match table_type.as_str() {
                    "TABLE" | "SYSTEM TABLE" | "ALIAS" | "SYNONYM" => "BASE TABLE",
                    "VIEW" | "MATERIALIZED VIEW" => "VIEW",
                    _ => continue,
                };
                let name = cell_text(&row.table);
                if name.is_empty() {
                    continue;
                }
                let parent_schema = cell_text(&row.schema);
                tables.push(TableInfo {
                    name,
                    table_type: table_type.to_string(),
                    valid: None,
                    comment: None,
                    parent_schema: if parent_schema.is_empty() { None } else { Some(parent_schema) },
                    parent_name: None,
                });
            }
            tables.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
            Ok(tables)
        })
        .await
        .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    pub async fn get_columns(client: &OdbcClient, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, String> {
        let client = client.clone();
        let schema = schema.to_string();
        let table = table.to_string();
        tokio::task::spawn_blocking(move || {
            let conn = lock_conn(&client)?;
            let schema_filter = if schema.is_empty() { "%".to_string() } else { schema };
            let primary_keys = primary_key_columns(&conn, &schema_filter, &table)?;
            let mut columns = Vec::new();
            for row in conn.columns("", &schema_filter, &table, "%").map_err(odbc_error)? {
                let row = row.map_err(odbc_error)?;
                let name = cell_text(&row.column_name);
                if name.is_empty() {
                    continue;
                }
                let precision = row.column_size.as_opt().copied();
                let scale = row.decimal_digits.as_opt().copied().map(i32::from);
                let default = cell_text(&row.column_default);
                columns.push(ColumnInfo {
                    is_primary_key: primary_keys.contains(&name),
                    data_type: cell_text(&row.type_name),
                    is_nullable: row.nullable == 1,
                    numeric_precision: if scale.is_some() { precision } else { None },
                    numeric_scale: scale,
                    character_maximum_length: if scale.is_none() { precision } else { None },
                    column_default: if default.is_empty() { None } else { Some(default) },
                    comment: None,
                    name,
                    ..Default::default()
                });
            }
            Ok(columns)
        })
        .await
        .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    fn primary_key_columns(
        conn: &Connection<'_>,
        schema: &str,
        table: &str,
    ) -> Result<Vec<String>, String> {
        let schema_filter = (!schema.is_empty()).then_some(schema);
        let mut keys = Vec::new();
        for row in conn.primary_keys(None, schema_filter, table).map_err(odbc_error)? {
            let row = row.map_err(odbc_error)?;
            let column = cell_text(&row.column);
            if !column.is_empty() {
                keys.push(column);
            }
        }
        Ok(keys)
    }

    pub async fn list_indexes(_client: &OdbcClient, _schema: &str, _table: &str) -> Result<Vec<IndexInfo>, String> {
        // Index metadata would need SQLStatistics, which odbc-api does not
        // expose; the sidebar renders an empty index list instead.
        Ok(Vec::new())
    }

    pub async fn list_foreign_keys(client: &OdbcClient, schema: &str, table: &str) -> Result<Vec<ForeignKeyInfo>, String> {
        let client = client.clone();
        let schema = schema.to_string();
        let table = table.to_string();
        tokio::task::spawn_blocking(move || {
            let conn = lock_conn(&client)?;
            let schema_filter = if schema.is_empty() { "%".to_string() } else { schema };
            let mut keys = Vec::new();
            // Foreign keys *defined in* the table: PK selectors empty, FK
            // selectors bound to the table.
            for row in conn.foreign_keys("", "", "", "", &schema_filter, &table).map_err(odbc_error)? {
                let row = row.map_err(odbc_error)?;
                let column = cell_text(&row.fk_column);
                let ref_table = cell_text(&row.pk_table);
                let ref_column = cell_text(&row.pk_column);
                if column.is_empty() || ref_column.is_empty() {
                    continue;
                }
                let ref_schema = cell_text(&row.pk_schema);
                keys.push(ForeignKeyInfo {
                    name: {
                        let fk_name = cell_text(&row.fk_name);
                        if fk_name.is_empty() { format!("fk_{}", column) } else { fk_name }
                    },
                    column,
                    ref_schema: if ref_schema.is_empty() { None } else { Some(ref_schema) },
                    ref_table,
                    ref_column,
                    on_update: rule_name(row.update_rule.as_opt().copied()),
                    on_delete: rule_name(row.delete_rule.as_opt().copied()),
                });
            }
            Ok(keys)
        })
        .await
        .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    /// ODBC rule codes shared by SQLForeignKeys UPDATE_RULE/DELETE_RULE.
    fn rule_name(rule: Option<i16>) -> Option<String> {
        match rule {
            Some(0) => Some("CASCADE".to_string()),
            Some(1) => Some("NO ACTION".to_string()),
            Some(2) => Some("SET NULL".to_string()),
            Some(3) => Some("SET DEFAULT".to_string()),
            Some(4) => Some("RESTRICT".to_string()),
            _ => None,
        }
    }

    /// SQL string literal with embedded single quotes doubled.
    fn sql_literal(value: &str) -> String {
        format!("'{}'", value.replace('\'', "''"))
    }

    /// Runs one metadata probe statement and returns its cells as text
    /// (NULL cells become empty strings).
    fn probe_rows_blocking(client: &OdbcClient, sql: &str) -> Result<Vec<Vec<String>>, String> {
        let result = execute_blocking(client, sql, Some(1000))?;
        Ok(result
            .rows
            .into_iter()
            .map(|row| {
                row.into_iter()
                    .map(|cell| cell.as_str().map(str::to_string).unwrap_or_default())
                    .collect()
            })
            .collect())
    }

    /// SQL Anywhere `SYS.SYSTRIGGER.event` codes: the single-letter values
    /// cover the combined INSERT/DELETE/UPDATE forms (SYS.SYSTRIGGER docs).
    fn sa_trigger_event(code: &str) -> String {
        match code {
            "I" => "INSERT",
            "U" => "UPDATE",
            "D" => "DELETE",
            "A" => "INSERT, DELETE",
            "B" => "INSERT, UPDATE",
            "E" => "DELETE, UPDATE",
            "M" => "INSERT, DELETE, UPDATE",
            "C" => "UPDATE OF COLUMNS",
            _ => "",
        }
        .to_string()
    }

    /// SQL Anywhere `SYS.SYSTRIGGER.trigger_time` codes; statement-level
    /// AFTER shares the AFTER label with the row-level form.
    fn sa_trigger_timing(code: &str) -> String {
        match code {
            "A" | "S" => "AFTER",
            "B" => "BEFORE",
            "I" | "K" => "INSTEAD OF",
            "R" => "RESOLVE",
            _ => "",
        }
        .to_string()
    }

    /// One trigger catalog probe row: name, parent table, event label,
    /// timing label.
    struct TriggerProbeRow {
        name: String,
        table: Option<String>,
        event: String,
        timing: String,
    }

    fn parse_trigger_rows(rows: Vec<Vec<String>>) -> Vec<TriggerProbeRow> {
        rows.into_iter()
            .filter_map(|row| {
                let name = row.first().map(|value| value.trim()).unwrap_or_default().to_string();
                if name.is_empty() {
                    return None;
                }
                Some(TriggerProbeRow {
                    name,
                    table: row.get(1).map(|value| value.trim().to_string()).filter(|value| !value.is_empty()),
                    event: row.get(2).map(|value| sa_trigger_event(value.trim())).unwrap_or_default(),
                    timing: row.get(3).map(|value| sa_trigger_timing(value.trim())).unwrap_or_default(),
                })
            })
            .collect()
    }

    /// No ODBC catalog function exposes triggers, so probe the engine's own
    /// system catalog: SQL Anywhere's SYS views first (owner-filtered when the
    /// caller narrowed a schema, since the SYS catalogs are owner-global),
    /// then the unfiltered SYS shape, then ASE's sysobjects shape. All
    /// failing (any other engine) — or matching nothing — yields an empty
    /// list; the sidebar and table-structure views treat that as "no
    /// triggers" instead of an error. Catalog columns are double-quoted
    /// because `event` is a reserved word in SQL Anywhere; the owner
    /// comparison is case-folded because catalog owner casing may differ
    /// from the schema label SQLTables reports. The listing does not read
    /// `source`/`trigger_defn` — they are missing from older SYS views, and
    /// a probe that names them fails wholesale on those servers.
    fn probe_triggers_blocking(client: &OdbcClient, schema: Option<&str>, table: Option<&str>) -> Vec<TriggerProbeRow> {
        let mut clauses = Vec::new();
        let owner_join = schema
            .map(|schema| {
                clauses.push(format!("LOWER(su.\"user_name\") = LOWER({})", sql_literal(schema)));
                " JOIN SYS.SYSUSER su ON st.\"creator\" = su.\"user_id\""
            })
            .unwrap_or_default();
        if let Some(table) = table {
            clauses.push(format!("st.\"table_name\" = {}", sql_literal(table)));
        }
        let where_sql = (!clauses.is_empty())
            .then(|| format!(" WHERE {}", clauses.join(" AND ")))
            .unwrap_or_default();
        let anywhere_sql = format!(
            "SELECT trig.\"trigger_name\", st.\"table_name\", trig.\"event\", trig.\"trigger_time\" \
             FROM SYS.SYSTRIGGER trig JOIN SYS.SYSTABLE st ON trig.\"table_id\" = st.\"table_id\"{owner_join}{where_sql} \
             ORDER BY st.\"table_name\", trig.\"trigger_name\""
        );
        match probe_rows_blocking(client, &anywhere_sql) {
            Ok(rows) => return parse_trigger_rows(rows),
            Err(error) => log::warn!("ODBC SQL Anywhere trigger probe (owner-filtered) failed: {error}"),
        }
        // The owner join is the most version-sensitive part of the probe; a
        // failure there must not lose the listing, so retry without it.
        let table_filter = table
            .map(|table| format!(" WHERE st.\"table_name\" = {}", sql_literal(table)))
            .unwrap_or_default();
        let global_sql = format!(
            "SELECT trig.\"trigger_name\", st.\"table_name\", trig.\"event\", trig.\"trigger_time\" \
             FROM SYS.SYSTRIGGER trig JOIN SYS.SYSTABLE st ON trig.\"table_id\" = st.\"table_id\"{table_filter} \
             ORDER BY st.\"table_name\", trig.\"trigger_name\""
        );
        match probe_rows_blocking(client, &global_sql) {
            Ok(rows) => return parse_trigger_rows(rows),
            Err(error) => log::warn!("ODBC SQL Anywhere trigger probe failed: {error}"),
        }
        // ASE: a table row's instrig/deltrig/updtrig columns hold the object
        // ids of its triggers; NULL columns keep the 4-column shape aligned
        // with the SQL Anywhere probe.
        let ase_filter = table
            .map(|table| format!(" AND tab.name = {}", sql_literal(table)))
            .unwrap_or_default();
        let ase_sql = format!(
            "SELECT trig.name, tab.name, NULL, NULL \
             FROM sysobjects trig, sysobjects tab \
             WHERE trig.type = 'TR' \
               AND (tab.instrig = trig.id OR tab.deltrig = trig.id OR tab.updtrig = trig.id){ase_filter} \
             ORDER BY trig.name"
        );
        match probe_rows_blocking(client, &ase_sql) {
            Ok(rows) => parse_trigger_rows(rows),
            Err(error) => {
                log::warn!("ODBC trigger probe failed on both SQL Anywhere and ASE catalogs: {error}");
                Vec::new()
            }
        }
    }

    /// Event names from SQL Anywhere's SYS.SYSEVENT, owner-filtered when the
    /// caller narrowed a schema; engines without the event scheduler
    /// (including ASE) get an empty list.
    fn probe_events_blocking(client: &OdbcClient, schema: Option<&str>) -> Vec<String> {
        if let Some(schema) = schema {
            let owner_sql = format!(
                "SELECT ev.\"event_name\" FROM SYS.SYSEVENT ev JOIN SYS.SYSUSER su ON ev.\"creator\" = su.\"user_id\" \
                 WHERE LOWER(su.\"user_name\") = LOWER({}) ORDER BY ev.\"event_name\"",
                sql_literal(schema)
            );
            if let Ok(rows) = probe_rows_blocking(client, &owner_sql) {
                return parse_name_rows(rows);
            }
        }
        match probe_rows_blocking(client, "SELECT \"event_name\" FROM SYS.SYSEVENT ORDER BY \"event_name\"") {
            Ok(rows) => parse_name_rows(rows),
            Err(error) => {
                log::debug!("ODBC event probe failed (engine has no SQL Anywhere event scheduler): {error}");
                Vec::new()
            }
        }
    }

    /// Procedure names from SQL Anywhere's SYS.SYSPROCEDURE (owner-filtered
    /// when the caller narrowed a schema), then ASE's `sysobjects` type='P'
    /// shape; failing both yields an empty list.
    fn probe_procedures_blocking(client: &OdbcClient, schema: Option<&str>) -> Vec<String> {
        if let Some(schema) = schema {
            let owner_sql = format!(
                "SELECT DISTINCT proc.\"proc_name\" FROM SYS.SYSPROCEDURE proc \
                 JOIN SYS.SYSUSER su ON proc.\"creator\" = su.\"user_id\" \
                 WHERE LOWER(su.\"user_name\") = LOWER({}) ORDER BY proc.\"proc_name\"",
                sql_literal(schema)
            );
            if let Ok(rows) = probe_rows_blocking(client, &owner_sql) {
                return parse_name_rows(rows);
            }
        }
        match probe_rows_blocking(client, "SELECT DISTINCT \"proc_name\" FROM SYS.SYSPROCEDURE ORDER BY \"proc_name\"") {
            Ok(rows) => return parse_name_rows(rows),
            Err(error) => log::warn!("ODBC SQL Anywhere procedure probe failed: {error}"),
        }
        match probe_rows_blocking(client, "SELECT name FROM sysobjects WHERE type = 'P' ORDER BY name") {
            Ok(rows) => parse_name_rows(rows),
            Err(error) => {
                log::warn!("ODBC procedure probe failed on both SQL Anywhere and ASE catalogs: {error}");
                Vec::new()
            }
        }
    }

    fn parse_name_rows(rows: Vec<Vec<String>>) -> Vec<String> {
        rows.into_iter()
            .filter_map(|row| {
                let name = row.first().map(|value| value.trim()).unwrap_or_default().to_string();
                (!name.is_empty()).then_some(name)
            })
            .collect()
    }

    pub async fn list_triggers(client: &OdbcClient, _schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
        let client = client.clone();
        let table = table.to_string();
        tokio::task::spawn_blocking(move || {
            // The SYS catalogs are owner-global, so the schema filter does not
            // narrow the scan; rows are filtered by table name server-side.
            Ok(probe_triggers_blocking(&client, None, (!table.is_empty()).then_some(table.as_str()))
                .into_iter()
                .map(|row| TriggerInfo {
                    name: row.name,
                    event: row.event,
                    timing: row.timing,
                    statement: None,
                    level: None,
                    condition: None,
                    language: None,
                    enabled: None,
                    valid: None,
                    comment: None,
                    created_at: None,
                    oracle_metadata: None,
                })
                .collect())
        })
        .await
        .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    /// Trigger objects for the sidebar's TRIGGER group, in the shape of
    /// `postgres::list_trigger_objects` (name plus parent table).
    pub async fn list_trigger_objects(client: &OdbcClient, schema: &str) -> Result<Vec<ObjectInfo>, String> {
        let client = client.clone();
        let schema = schema.to_string();
        tokio::task::spawn_blocking(move || {
            let owner = (!schema.is_empty()).then(|| schema.clone());
            Ok(probe_triggers_blocking(&client, owner.as_deref(), None)
                .into_iter()
                .map(|row| ObjectInfo {
                    name: row.name,
                    object_type: "TRIGGER".to_string(),
                    schema: owner.clone(),
                    valid: None,
                    signature: None,
                    custom_type_kind: None,
                    has_members: None,
                    comment: None,
                    created_at: None,
                    updated_at: None,
                    parent_schema: owner.clone(),
                    parent_name: row.table,
                    trigger: None,
                    xugu_type_members_expandable: None,
                })
                .collect())
        })
        .await
        .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    /// Event objects for the sidebar's EVENT group. SQL Anywhere's event
    /// scheduler only; engines without SYS.SYSEVENT get an empty list.
    pub async fn list_event_objects(client: &OdbcClient, schema: &str) -> Result<Vec<ObjectInfo>, String> {
        let client = client.clone();
        let schema = schema.to_string();
        tokio::task::spawn_blocking(move || {
            let owner = (!schema.is_empty()).then(|| schema.clone());
            Ok(probe_events_blocking(&client, owner.as_deref())
                .into_iter()
                .map(|name| ObjectInfo {
                    name,
                    object_type: "EVENT".to_string(),
                    schema: owner.clone(),
                    valid: None,
                    signature: None,
                    custom_type_kind: None,
                    has_members: None,
                    comment: None,
                    created_at: None,
                    updated_at: None,
                    parent_schema: None,
                    parent_name: None,
                    trigger: None,
                    xugu_type_members_expandable: None,
                })
                .collect())
        })
        .await
        .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    /// Procedure objects for the sidebar's PROCEDURE group. SQL Anywhere
    /// catalogs functions as procedures (they carry a RETURN parameter), so
    /// both appear here as PROCEDURE.
    pub async fn list_procedure_objects(client: &OdbcClient, schema: &str) -> Result<Vec<ObjectInfo>, String> {
        let client = client.clone();
        let schema = schema.to_string();
        tokio::task::spawn_blocking(move || {
            let owner = (!schema.is_empty()).then(|| schema.clone());
            Ok(probe_procedures_blocking(&client, owner.as_deref())
                .into_iter()
                .map(|name| ObjectInfo {
                    name,
                    object_type: "PROCEDURE".to_string(),
                    schema: owner.clone(),
                    valid: None,
                    signature: None,
                    custom_type_kind: None,
                    has_members: None,
                    comment: None,
                    created_at: None,
                    updated_at: None,
                    parent_schema: None,
                    parent_name: None,
                    trigger: None,
                    xugu_type_members_expandable: None,
                })
                .collect())
        })
        .await
        .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    pub async fn table_ddl(_client: &OdbcClient, _table: &str) -> Result<String, String> {
        Err("Table DDL is not available through the generic ODBC driver".to_string())
    }

    pub async fn object_source(
        client: &OdbcClient,
        name: &str,
        object_type: &ObjectSourceKind,
    ) -> Result<ObjectSource, String> {
        let client = client.clone();
        let name = name.to_string();
        let object_type = object_type.clone();
        tokio::task::spawn_blocking(move || {
            // Trigger/event/procedure definitions come from the same engine
            // catalogs the listings probe (SQL Anywhere SYS views); other
            // object kinds have no driver-independent source path. `source`
            // is missing from older SYS views, so `trigger_defn`/`proc_defn`
            // are tried as fallbacks before giving up.
            let (catalog, name_column, source_columns) = match &object_type {
                ObjectSourceKind::Trigger => ("SYS.SYSTRIGGER", "trigger_name", ["source", "trigger_defn"]),
                ObjectSourceKind::Event => ("SYS.SYSEVENT", "event_name", ["source", "source"]),
                ObjectSourceKind::Procedure => ("SYS.SYSPROCEDURE", "proc_name", ["source", "proc_defn"]),
                _ => {
                    return Err("Object source is not available through the generic ODBC driver".to_string());
                }
            };
            for source_column in source_columns {
                let source_sql = format!(
                    "SELECT \"{name_column}\", \"{source_column}\" FROM {catalog} WHERE \"{name_column}\" = {}",
                    sql_literal(&name)
                );
                let Ok(rows) = probe_rows_blocking(&client, &source_sql) else {
                    continue;
                };
                if let Some(source) = rows
                    .first()
                    .and_then(|row| row.get(1))
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                {
                    return Ok(ObjectSource {
                        name,
                        object_type,
                        schema: None,
                        source,
                        editable: None,
                        routine_parameters: None,
                        trigger: None,
                    });
                }
            }
            Err(format!("No source found for ODBC {object_type:?} `{name}`"))
        })
        .await
        .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    pub async fn execute_query(client: &OdbcClient, sql: &str) -> Result<QueryResult, String> {
        execute_query_with_max_rows(client, sql, None).await
    }

    pub async fn execute_query_with_max_rows(
        client: &OdbcClient,
        sql: &str,
        max_rows: Option<usize>,
    ) -> Result<QueryResult, String> {
        let client = client.clone();
        let sql = sql.to_string();
        tokio::task::spawn_blocking(move || execute_blocking(&client, &sql, max_rows))
            .await
            .map_err(|e| format!("ODBC worker task failed: {e}"))?
    }

    fn execute_blocking(client: &OdbcClient, sql: &str, max_rows: Option<usize>) -> Result<QueryResult, String> {
        let start = Instant::now();
        let conn = lock_conn(client)?;
        let mut statement = conn.preallocate().map_err(odbc_error)?;
        if let Some(timeout) = client.query_timeout_sec {
            statement.set_query_timeout_sec(timeout).map_err(odbc_error)?;
        }
        // Publish the statement handle so a concurrent cancel request can
        // reach the running statement, then execute.
        let cancel_handle = CancelHandle(statement.as_stmt_ref().as_sys());
        {
            let mut active = lock_active(client)?;
            *active = Some(cancel_handle);
        }
        let result = run_statement(&mut statement, cancel_handle, sql, max_rows, start);
        {
            let mut active = lock_active(client)?;
            *active = None;
        }
        result
    }

    fn run_statement(
        statement: &mut odbc_api::Preallocated<odbc_api::handles::StatementImpl<'_>>,
        cancel_handle: CancelHandle,
        sql: &str,
        max_rows: Option<usize>,
        start: Instant,
    ) -> Result<QueryResult, String> {
        let executed = statement.execute(sql, ()).map_err(odbc_error)?;
        let Some(mut cursor) = executed else {
            // No result set: an UPDATE/DELETE/DDL statement; report affected
            // rows. The raw SQLRowCount call goes through the handle captured
            // before execute because the `executed` binding still borrows the
            // statement here.
            let mut count: sys::Len = -1;
            if unsafe { sys::SQLRowCount(cancel_handle.0, &mut count) } != sys::SqlReturn::SUCCESS {
                count = -1;
            }
            let affected_rows = count.max(-1);
            let affected_rows =
                if affected_rows == -1 { 0u64 } else { affected_rows as u64 };
            return Ok(QueryResult {
                columns: vec![],
                column_types: Vec::new(),
                deferred_large_value_cells: Vec::new(),
                column_sortables: vec![],
                spatial_columns: vec![],
                raw_key_cells: Vec::new(),
                spatial_values: Vec::new(),
                rows: vec![],
                affected_rows,
                execution_time_ms: start.elapsed().as_millis(),
                server_execute_time_us: None,
                query_timings_ms: None,
                truncated: false,
                session_id: None,
                has_more: false,
                elasticsearch_raw_body: None,
                messages: Vec::new(),
            });
        };
        let num_columns = cursor.num_result_cols().map_err(odbc_error)?.max(0) as usize;
        let mut columns = Vec::with_capacity(num_columns);
        let mut column_types = Vec::with_capacity(num_columns);
        for index in 1..=num_columns {
            let mut description = odbc_api::handles::ColumnDescription::default();
            cursor.describe_col(index as u16, &mut description).map_err(odbc_error)?;
            columns.push(description.name_to_string().unwrap_or_else(|_| format!("column{index}")));
            column_types.push(data_type_name(&description.data_type));
        }
        let row_limit = max_rows.unwrap_or(MAX_ROWS).max(1);
        let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
        let mut truncated = false;
        let mut text_buffer: Vec<u16> = Vec::new();
        loop {
            match cursor.next_row().map_err(odbc_error)? {
                Some(mut row) => {
                    if rows.len() >= row_limit {
                        // One extra row observed past the limit.
                        truncated = true;
                        break;
                    }
                    let mut cells = Vec::with_capacity(num_columns);
                    for index in 1..=num_columns {
                        // Wide (UTF-16) fetch keeps driver-side
                        // ANSI conversions out of the path, so
                        // non-ASCII data survives on any locale.
                        if row.get_wide_text(index as u16, &mut text_buffer).map_err(odbc_error)? {
                            cells.push(serde_json::Value::String(String::from_utf16_lossy(&text_buffer)));
                        } else {
                            cells.push(serde_json::Value::Null);
                        }
                    }
                    rows.push(cells);
                }
                None => break,
            }
        }
        drop(cursor);
        Ok(QueryResult {
            columns,
            column_types,
            deferred_large_value_cells: Vec::new(),
            column_sortables: vec![],
            spatial_columns: vec![],
            raw_key_cells: Vec::new(),
            spatial_values: Vec::new(),
            rows,
            affected_rows: 0,
            execution_time_ms: start.elapsed().as_millis(),
            server_execute_time_us: None,
            query_timings_ms: None,
            truncated,
            session_id: None,
            has_more: false,
            elasticsearch_raw_body: None,
            messages: Vec::new(),
        })
    }

    fn odbc_error(error: odbc_api::Error) -> String {
        format!("ODBC error: {error}")
    }

    fn cell_text<const LENGTH: usize>(value: &VarCharArray<LENGTH>) -> String {
        value.as_str().ok().flatten().unwrap_or("").to_string()
    }

    fn data_type_name(data_type: &DataType) -> String {
        match data_type {
            DataType::Unknown => "UNKNOWN".to_string(),
            DataType::Char { .. } | DataType::WChar { .. } => "CHAR".to_string(),
            DataType::Numeric { .. } => "NUMERIC".to_string(),
            DataType::Decimal { .. } => "DECIMAL".to_string(),
            DataType::Integer => "INTEGER".to_string(),
            DataType::SmallInt => "SMALLINT".to_string(),
            DataType::Float { .. } => "FLOAT".to_string(),
            DataType::Real => "REAL".to_string(),
            DataType::Double => "DOUBLE".to_string(),
            DataType::Varchar { .. } | DataType::WVarchar { .. } => "VARCHAR".to_string(),
            DataType::LongVarchar { .. } | DataType::WLongVarchar { .. } => "TEXT".to_string(),
            DataType::LongVarbinary { .. } => "BLOB".to_string(),
            DataType::Varbinary { .. } | DataType::Binary { .. } => "BINARY".to_string(),
            DataType::Date => "DATE".to_string(),
            DataType::Time { .. } => "TIME".to_string(),
            DataType::Timestamp { .. } => "TIMESTAMP".to_string(),
            DataType::BigInt => "BIGINT".to_string(),
            DataType::TinyInt => "TINYINT".to_string(),
            DataType::Bit => "BIT".to_string(),
            DataType::Other { .. } => "OTHER".to_string(),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn appends_credentials_only_when_missing() {
            assert_eq!(
                compose_connection_string("DSN=SybaseProd", "sa", "secret;pass"),
                "DSN=SybaseProd;UID=sa;PWD={secret;pass}"
            );
            // A literal '}' inside the value is escaped by doubling it.
            assert_eq!(
                compose_connection_string("DSN=SybaseProd", "sa", "p}w;ord"),
                "DSN=SybaseProd;UID=sa;PWD={p}}w;ord}"
            );
            assert_eq!(
                compose_connection_string("Driver={Adaptive Server Enterprise};Server=db,5000;UID=ops;PWD=x", "sa", "y"),
                "Driver={Adaptive Server Enterprise};Server=db,5000;UID=ops;PWD=x"
            );
            assert_eq!(compose_connection_string("DSN=x;", "  ", ""), "DSN=x");
        }

        #[test]
        fn has_attribute_ignores_braced_content_and_case() {
            assert!(has_attribute("Driver={a;b};UID=sa", "uid"));
            assert!(has_attribute("PWD={x;y}", "PWD"));
            assert!(!has_attribute("Driver={UID=no}", "UID"));
            assert!(!has_attribute("DSN=x", "UID"));
        }

        #[test]
        fn attribute_value_reads_database_with_braces() {
            assert_eq!(attribute_value("Driver={a;b};DATABASE=pubs2;UID=sa", "database").as_deref(), Some("pubs2"));
            assert_eq!(attribute_value("Driver={a;b};DATABASE={my db}", "DATABASE").as_deref(), Some("my db"));
            // Inside braced content does not count; empty does not count.
            assert_eq!(attribute_value("Driver={DATABASE=no};UID=sa", "DATABASE"), None);
            assert_eq!(attribute_value("DSN=x;DATABASE=;UID=sa", "DATABASE"), None);
        }

        #[test]
        fn maps_odbc_rule_codes() {
            assert_eq!(rule_name(Some(0)).as_deref(), Some("CASCADE"));
            assert_eq!(rule_name(Some(4)).as_deref(), Some("RESTRICT"));
            assert_eq!(rule_name(None), None);
            assert_eq!(rule_name(Some(9)), None);
        }

        #[test]
        fn quotes_sql_literals_by_doubling_embedded_quotes() {
            assert_eq!(sql_literal("orders"), "'orders'");
            assert_eq!(sql_literal("o'brien's"), "'o''brien''s'");
        }

        #[test]
        fn maps_sql_anywhere_trigger_event_and_timing_codes() {
            assert_eq!(sa_trigger_event("I"), "INSERT");
            assert_eq!(sa_trigger_event("M"), "INSERT, DELETE, UPDATE");
            assert_eq!(sa_trigger_event("Q"), "");
            assert_eq!(sa_trigger_timing("A"), "AFTER");
            assert_eq!(sa_trigger_timing("S"), "AFTER");
            assert_eq!(sa_trigger_timing("B"), "BEFORE");
            assert_eq!(sa_trigger_timing("I"), "INSTEAD OF");
            assert_eq!(sa_trigger_timing("Z"), "");
        }

        #[test]
        fn parses_trigger_probe_rows_from_both_catalog_shapes() {
            // SQL Anywhere shape: name, table, event code, timing code.
            let anywhere = parse_trigger_rows(vec![vec![
                "t_ins".to_string(),
                "orders".to_string(),
                "I".to_string(),
                "A".to_string(),
            ]]);
            assert_eq!(anywhere.len(), 1);
            assert_eq!(anywhere[0].name, "t_ins");
            assert_eq!(anywhere[0].table.as_deref(), Some("orders"));
            assert_eq!(anywhere[0].event, "INSERT");
            assert_eq!(anywhere[0].timing, "AFTER");

            // ASE shape: name, table, NULL, NULL — empty labels.
            let ase = parse_trigger_rows(vec![vec![
                "t_del".to_string(),
                "orders".to_string(),
                String::new(),
                String::new(),
            ]]);
            assert_eq!(ase.len(), 1);
            assert_eq!(ase[0].event, "");
            assert_eq!(ase[0].timing, "");

            // Nameless rows are dropped; missing columns default to empty.
            assert!(parse_trigger_rows(vec![vec![String::new()]]).is_empty());
            let short = parse_trigger_rows(vec![vec!["t".to_string()]]);
            assert_eq!(short.len(), 1);
            assert_eq!(short[0].table, None);
            assert_eq!(short[0].event, "");
        }

        #[test]
        fn parses_first_column_name_rows_for_events_and_procedures() {
            let names = parse_name_rows(vec![
                vec!["nightly_backup".to_string()],
                vec![String::new()],
                vec!["hourly_stats".to_string()],
            ]);
            assert_eq!(names, vec!["nightly_backup".to_string(), "hourly_stats".to_string()]);
        }
    }
}

#[cfg(windows)]
pub use imp::*;

#[cfg(not(windows))]
mod imp {
    use std::time::Duration;

    use crate::models::connection::ConnectionConfig;
    use crate::types::{
        ColumnInfo, DatabaseInfo, ForeignKeyInfo, IndexInfo, ObjectInfo, ObjectSource,
        ObjectSourceKind, QueryResult, TableInfo, TriggerInfo,
    };

    #[derive(Clone, Default)]
    pub struct OdbcClient;

    impl OdbcClient {
        pub fn cancel_interrupt(&self) -> impl Fn() + Send + 'static {
            move || {}
        }
    }

    fn unsupported<T>() -> Result<T, String> {
        Err("ODBC connections are only supported in Windows builds".to_string())
    }

    pub fn connect(
        _connection_string: &str,
        _username: &str,
        _password: &str,
        _connect_timeout: Duration,
        _query_timeout_sec: Option<usize>,
    ) -> Result<OdbcClient, String> {
        unsupported()
    }

    pub fn connect_from_config(
        _config: &ConnectionConfig,
        _connect_timeout: Duration,
    ) -> Result<OdbcClient, String> {
        unsupported()
    }

    pub async fn test_connection(_client: &OdbcClient, _timeout: Duration) -> Result<(), String> {
        unsupported()
    }

    pub async fn health_check(_client: &OdbcClient) -> Result<(), String> {
        unsupported()
    }

    pub async fn list_databases(_client: &OdbcClient) -> Result<Vec<DatabaseInfo>, String> {
        unsupported()
    }

    pub async fn list_schemas(_client: &OdbcClient) -> Result<Vec<String>, String> {
        unsupported()
    }

    pub async fn list_tables(_client: &OdbcClient, _schema: &str) -> Result<Vec<TableInfo>, String> {
        unsupported()
    }

    pub async fn get_columns(
        _client: &OdbcClient,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<ColumnInfo>, String> {
        unsupported()
    }

    pub async fn list_indexes(
        _client: &OdbcClient,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<IndexInfo>, String> {
        unsupported()
    }

    pub async fn list_foreign_keys(
        _client: &OdbcClient,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, String> {
        unsupported()
    }

    pub async fn list_triggers(
        _client: &OdbcClient,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<TriggerInfo>, String> {
        unsupported()
    }

    pub async fn list_trigger_objects(_client: &OdbcClient, _schema: &str) -> Result<Vec<ObjectInfo>, String> {
        unsupported()
    }

    pub async fn list_event_objects(_client: &OdbcClient, _schema: &str) -> Result<Vec<ObjectInfo>, String> {
        unsupported()
    }

    pub async fn list_procedure_objects(_client: &OdbcClient, _schema: &str) -> Result<Vec<ObjectInfo>, String> {
        unsupported()
    }

    pub async fn table_ddl(_client: &OdbcClient, _table: &str) -> Result<String, String> {
        unsupported()
    }

    pub async fn object_source(
        _client: &OdbcClient,
        _name: &str,
        _object_type: &ObjectSourceKind,
    ) -> Result<ObjectSource, String> {
        unsupported()
    }

    pub async fn execute_query(_client: &OdbcClient, _sql: &str) -> Result<QueryResult, String> {
        unsupported()
    }

    pub async fn execute_query_with_max_rows(
        _client: &OdbcClient,
        _sql: &str,
        _max_rows: Option<usize>,
    ) -> Result<QueryResult, String> {
        unsupported()
    }
}

#[cfg(not(windows))]
pub use imp::*;
