use std::sync::Arc;

use crate::commands::connection::AppState;
use dbx_core::csv_export::{
    export_table_data_csv_core, format_query_result_csv_with_format, resolve_csv_delimiter, resolve_csv_quote_char,
    CsvQuoteMode, CsvTextFormat, TableCsvExportOptions,
};
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResultCsvExportRequest {
    pub file_path: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    #[serde(default)]
    pub csv_quote_mode: CsvQuoteMode,
    #[serde(default)]
    pub csv_delimiter: String,
    #[serde(default)]
    pub csv_quote_char: String,
    #[serde(default = "default_csv_include_header")]
    pub csv_include_header: bool,
}

fn default_csv_include_header() -> bool {
    true
}

#[tauri::command]
pub async fn export_query_result_csv(request: QueryResultCsvExportRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let csv = format_query_result_csv_with_format(
            &request.columns,
            &request.rows,
            CsvTextFormat {
                quote_mode: request.csv_quote_mode,
                delimiter: resolve_csv_delimiter(&request.csv_delimiter),
                quote_char: resolve_csv_quote_char(&request.csv_quote_char),
                include_header: request.csv_include_header,
            },
        );
        std::fs::write(&request.file_path, format!("\u{FEFF}{csv}")).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn export_table_data_csv(
    state: State<'_, Arc<AppState>>,
    request: TableCsvExportOptions,
) -> Result<u64, String> {
    export_table_data_csv_core(&state, request).await
}
