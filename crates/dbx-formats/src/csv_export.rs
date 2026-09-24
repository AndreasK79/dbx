use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;
use std::io::Write;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CsvQuoteMode {
    #[default]
    All,
    Necessary,
    Never,
}

/// 分隔符 + 引号模式 + 引号字符 + 表头开关：导出对话框一次选定后随请求下发，
/// 格式化函数按它写单元格。`Default` 保持旧语义（逗号 + `"` + 全部加引号 + 含表头），
/// legacy `_with_quote_mode` 系列委托到这里的默认变体。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CsvTextFormat {
    pub quote_mode: CsvQuoteMode,
    pub delimiter: char,
    pub quote_char: char,
    pub include_header: bool,
}

impl Default for CsvTextFormat {
    fn default() -> Self {
        Self { quote_mode: CsvQuoteMode::All, delimiter: ',', quote_char: '"', include_header: true }
    }
}

impl From<CsvQuoteMode> for CsvTextFormat {
    fn from(quote_mode: CsvQuoteMode) -> Self {
        Self { quote_mode, ..Default::default() }
    }
}

/// 请求里的分隔符是字符串（serde 兼容旧前端缺省）；取首字符，空串回退逗号。
pub fn resolve_csv_delimiter(value: &str) -> char {
    value.chars().next().unwrap_or(',')
}

/// 请求里的引号字符同样是字符串；取首字符，空串回退 `"`。
pub fn resolve_csv_quote_char(value: &str) -> char {
    value.chars().next().unwrap_or('"')
}

/// CSV 转义直写目标 buffer：包引号 + 内部引号字符翻倍。值不含引号字符时整段拷贝，
/// 不做 replace 分配（逐批流式导出对每个单元格调用，是导出热路径）。
fn push_csv_escaped_content(out: &mut String, value: &str, quote_char: char) {
    let mut rest = value;
    while let Some(pos) = rest.find(quote_char) {
        out.push_str(&rest[..=pos]);
        out.push(quote_char);
        rest = &rest[pos + quote_char.len_utf8()..];
    }
    out.push_str(rest);
}

pub fn push_csv_escaped(out: &mut String, value: &str) {
    push_csv_escaped_with_quote(out, value, '"');
}

pub fn push_csv_escaped_with_quote(out: &mut String, value: &str, quote_char: char) {
    out.push(quote_char);
    push_csv_escaped_content(out, value, quote_char);
    out.push(quote_char);
}

fn csv_field_needs_quotes(value: &str, delimiter: char, quote_char: char) -> bool {
    value.chars().any(|ch| matches!(ch, '\n' | '\r') || ch == delimiter || ch == quote_char)
}

pub fn push_csv_field(out: &mut String, value: &str, quote_mode: CsvQuoteMode) {
    push_csv_field_with_format(out, value, CsvTextFormat::from(quote_mode));
}

pub fn push_csv_field_with_format(out: &mut String, value: &str, format: CsvTextFormat) {
    match format.quote_mode {
        CsvQuoteMode::All => push_csv_escaped_with_quote(out, value, format.quote_char),
        // Never 显式不加引号（即使值含分隔符/引号/换行，由用户自担）；
        // Necessary 只在破坏字段结构时加引号。
        CsvQuoteMode::Necessary if csv_field_needs_quotes(value, format.delimiter, format.quote_char) => {
            push_csv_escaped_with_quote(out, value, format.quote_char);
        }
        _ => out.push_str(value),
    }
}

struct CsvEscapedWriter<'a>(&'a mut String, char);

impl fmt::Write for CsvEscapedWriter<'_> {
    fn write_str(&mut self, value: &str) -> fmt::Result {
        push_csv_escaped_content(self.0, value, self.1);
        Ok(())
    }
}

/// 将表导出 CSV 值直接写入已有 buffer；包括 NULL 在内的值均保留分页导出的带引号旧语义。
pub fn push_csv_text_value(out: &mut String, value: &Value) {
    push_csv_text_value_with_quote(out, value, '"');
}

pub fn push_csv_text_value_with_quote(out: &mut String, value: &Value, quote_char: char) {
    out.push(quote_char);
    match value {
        Value::Null => {}
        Value::String(value) => push_csv_escaped_content(out, value, quote_char),
        Value::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) => {
            fmt::write(out, format_args!("{value}")).expect("writing a number into a String cannot fail")
        }
        // 数组和对象可能包含引号，通过转义 writer 格式化，避免分配中间 JSON 字符串
        other => fmt::write(&mut CsvEscapedWriter(out, quote_char), format_args!("{other}"))
            .expect("writing JSON into a String cannot fail"),
    }
    out.push(quote_char);
}

fn push_csv_value_formatted(out: &mut String, value: &Value, format: CsvTextFormat, quote_null: bool) {
    if format.quote_mode == CsvQuoteMode::All {
        if value.is_null() && !quote_null {
            return;
        }
        push_csv_text_value_with_quote(out, value, format.quote_char);
        return;
    }

    match value {
        Value::Null => {}
        Value::String(value) => push_csv_field_with_format(out, value, format),
        Value::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) => {
            fmt::write(out, format_args!("{value}")).expect("writing a number into a String cannot fail")
        }
        other => push_csv_field_with_format(out, &other.to_string(), format),
    }
}

/// TSV 转义直写：仅含特殊字符时包引号（语义与原 escape_tsv 一致）。
fn push_tsv_escaped(out: &mut String, value: &str) {
    if value.contains('\t') || value.contains('\n') || value.contains('\r') || value.contains('"') {
        push_csv_escaped(out, value);
    } else {
        out.push_str(value);
    }
}

fn push_tsv_value(out: &mut String, value: &Value) {
    match value {
        Value::Null => {}
        Value::String(v) => push_tsv_escaped(out, v),
        Value::Bool(v) => out.push_str(if *v { "true" } else { "false" }),
        Value::Number(value) => {
            fmt::write(out, format_args!("{value}")).expect("writing a number into a String cannot fail")
        }
        other => push_tsv_escaped(out, &other.to_string()),
    }
}

pub fn push_tsv_row(out: &mut String, row: &[Value]) {
    for (cell_index, cell) in row.iter().enumerate() {
        if cell_index > 0 {
            out.push('\t');
        }
        push_tsv_value(out, cell);
    }
}

/// 预分配粗估：按全部行的实际单元格数求和（不假设等宽），饱和运算防溢出，
/// 并设上限——估算只是性能提示，绝不能因病态输入放大成巨额分配
const ROWS_CAPACITY_ESTIMATE_MAX: usize = 16 * 1024 * 1024;

pub fn estimated_rows_capacity(rows: &[Vec<Value>]) -> usize {
    let cells: usize = rows.iter().map(Vec::len).fold(0usize, usize::saturating_add);
    cells.saturating_mul(12).min(ROWS_CAPACITY_ESTIMATE_MAX)
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn escape_csv(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    push_csv_escaped(&mut out, value);
    out
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn escape_tsv(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    push_tsv_escaped(&mut out, value);
    out
}

fn push_tsv_rows(out: &mut String, rows: &[Vec<Value>]) {
    for (row_index, row) in rows.iter().enumerate() {
        if row_index > 0 {
            out.push('\n');
        }
        push_tsv_row(out, row);
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn format_tsv_rows(rows: &[Vec<Value>]) -> String {
    let mut out = String::with_capacity(estimated_rows_capacity(rows));
    push_tsv_rows(&mut out, rows);
    out
}

pub fn format_tsv(columns: &[String], rows: &[Vec<Value>]) -> String {
    let mut out = String::with_capacity(
        estimated_rows_capacity(rows).saturating_add(columns.len().saturating_mul(12)).min(ROWS_CAPACITY_ESTIMATE_MAX),
    );
    for (index, column) in columns.iter().enumerate() {
        if index > 0 {
            out.push('\t');
        }
        push_tsv_escaped(&mut out, column);
    }
    out.push('\n');
    push_tsv_rows(&mut out, rows);
    out
}

/// Format query-result rows as CSV text without a header row. Database NULLs
/// use the same empty-cell representation as table-data exports. Used by the
/// streaming query-result export for batches after the first.
pub fn push_query_result_csv_row(out: &mut String, row: &[Value]) {
    push_query_result_csv_row_with_quote_mode(out, row, CsvQuoteMode::All);
}

pub fn push_query_result_csv_row_with_quote_mode(out: &mut String, row: &[Value], quote_mode: CsvQuoteMode) {
    push_query_result_csv_row_with_format(out, row, CsvTextFormat::from(quote_mode));
}

pub fn push_query_result_csv_row_with_format(out: &mut String, row: &[Value], format: CsvTextFormat) {
    for (cell_index, cell) in row.iter().enumerate() {
        if cell_index > 0 {
            out.push(format.delimiter);
        }
        push_csv_value_formatted(out, cell, format, false);
    }
}

pub fn push_table_csv_row(out: &mut String, row: &[Value]) {
    push_table_csv_row_with_quote_mode(out, row, CsvQuoteMode::All);
}

pub fn push_table_csv_row_with_quote_mode(out: &mut String, row: &[Value], quote_mode: CsvQuoteMode) {
    push_table_csv_row_with_format(out, row, CsvTextFormat::from(quote_mode));
}

pub fn push_table_csv_row_with_format(out: &mut String, row: &[Value], format: CsvTextFormat) {
    for (cell_index, cell) in row.iter().enumerate() {
        if cell_index > 0 {
            out.push(format.delimiter);
        }
        push_csv_value_formatted(out, cell, format, true);
    }
}

fn push_query_result_csv_rows(out: &mut String, rows: &[Vec<Value>]) {
    for (row_index, row) in rows.iter().enumerate() {
        if row_index > 0 {
            out.push('\n');
        }
        push_query_result_csv_row(out, row);
    }
}

pub fn format_query_result_csv_rows(rows: &[Vec<Value>]) -> String {
    let mut out = String::with_capacity(estimated_rows_capacity(rows));
    push_query_result_csv_rows(&mut out, rows);
    out
}

fn format_csv_with_value_formatter(columns: &[String], rows: &[Vec<Value>]) -> String {
    let mut out = String::with_capacity(
        estimated_rows_capacity(rows).saturating_add(columns.len().saturating_mul(12)).min(ROWS_CAPACITY_ESTIMATE_MAX),
    );
    for (index, column) in columns.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        push_csv_escaped(&mut out, column);
    }
    out.push('\n');
    push_query_result_csv_rows(&mut out, rows);
    out
}

pub fn format_csv(columns: &[String], rows: &[Vec<Value>]) -> String {
    format_csv_with_value_formatter(columns, rows)
}

pub fn format_csv_with_quote_mode(columns: &[String], rows: &[Vec<Value>], quote_mode: CsvQuoteMode) -> String {
    format_csv_with_format(columns, rows, CsvTextFormat::from(quote_mode))
}

pub fn format_csv_with_format(columns: &[String], rows: &[Vec<Value>], format: CsvTextFormat) -> String {
    let mut out = String::with_capacity(
        estimated_rows_capacity(rows).saturating_add(columns.len().saturating_mul(12)).min(ROWS_CAPACITY_ESTIMATE_MAX),
    );
    // 表头关闭时首行直接是数据行；各流式导出路径的表头也统一走这里（空表头
    // 返回空串，写侧 write_all 空串等价于跳过，行写入各自前置 '\n' 不受影响）。
    if format.include_header {
        for (index, column) in columns.iter().enumerate() {
            if index > 0 {
                out.push(format.delimiter);
            }
            push_csv_field_with_format(&mut out, column, format);
        }
        out.push('\n');
    }
    for (row_index, row) in rows.iter().enumerate() {
        if row_index > 0 {
            out.push('\n');
        }
        push_query_result_csv_row_with_format(&mut out, row, format);
    }
    out
}

pub fn format_query_result_csv(columns: &[String], rows: &[Vec<Value>]) -> String {
    format_csv(columns, rows)
}

pub fn format_query_result_csv_with_quote_mode(
    columns: &[String],
    rows: &[Vec<Value>],
    quote_mode: CsvQuoteMode,
) -> String {
    format_csv_with_format(columns, rows, CsvTextFormat::from(quote_mode))
}

pub fn format_query_result_csv_with_format(columns: &[String], rows: &[Vec<Value>], format: CsvTextFormat) -> String {
    format_csv_with_format(columns, rows, format)
}

pub fn write_csv_text_row(
    writer: &mut impl Write,
    values: impl IntoIterator<Item = String>,
    quote_mode: CsvQuoteMode,
) -> Result<(), String> {
    write_csv_text_row_with_format(writer, values, CsvTextFormat::from(quote_mode))
}

pub fn write_csv_text_row_with_format(
    writer: &mut impl Write,
    values: impl IntoIterator<Item = String>,
    format: CsvTextFormat,
) -> Result<(), String> {
    let delimiter = format.delimiter.to_string();
    let mut first = true;
    for value in values {
        if !first {
            writer.write_all(delimiter.as_bytes()).map_err(|err| err.to_string())?;
        }
        first = false;
        let mut formatted = String::with_capacity(value.len() + 2);
        push_csv_field_with_format(&mut formatted, &value, format);
        writer.write_all(formatted.as_bytes()).map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub fn write_csv_value_row(
    writer: &mut impl Write,
    values: impl IntoIterator<Item = Value>,
    quote_mode: CsvQuoteMode,
) -> Result<(), String> {
    write_csv_value_row_with_format(writer, values, CsvTextFormat::from(quote_mode))
}

pub fn write_csv_value_row_with_format(
    writer: &mut impl Write,
    values: impl IntoIterator<Item = Value>,
    format: CsvTextFormat,
) -> Result<(), String> {
    let delimiter = format.delimiter.to_string();
    let mut first = true;
    for value in values {
        if !first {
            writer.write_all(delimiter.as_bytes()).map_err(|err| err.to_string())?;
        }
        first = false;
        let formatted = if format.quote_mode == CsvQuoteMode::All {
            let mut formatted = String::new();
            if !value.is_null() {
                push_csv_text_value_with_quote(&mut formatted, &value, format.quote_char);
            }
            formatted
        } else {
            let mut formatted = String::new();
            push_csv_value_formatted(&mut formatted, &value, format, false);
            formatted
        };
        writer.write_all(formatted.as_bytes()).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        format_csv, format_csv_with_quote_mode, format_query_result_csv, format_query_result_csv_rows, format_tsv,
        CsvQuoteMode,
    };
    use serde_json::json;

    #[test]
    fn formats_csv_with_header_and_escaped_values() {
        let out = format_csv(&["id".to_string(), "name".to_string()], &[vec![json!(1), json!("Ada \"Lovelace\"")]]);
        assert_eq!(out, "\"id\",\"name\"\n\"1\",\"Ada \"\"Lovelace\"\"\"");
    }

    #[test]
    fn formats_null_as_empty_cell() {
        let out = format_csv(&["id".to_string(), "note".to_string()], &[vec![json!(1), Value::Null]]);
        assert_eq!(out, "\"id\",\"note\"\n\"1\",");
    }

    #[test]
    fn formats_query_result_null_as_empty_cell() {
        let out = format_query_result_csv(&["id".to_string(), "note".to_string()], &[vec![json!(1), Value::Null]]);
        assert_eq!(out, "\"id\",\"note\"\n\"1\",");
    }

    #[test]
    fn necessary_quote_mode_only_quotes_csv_special_characters() {
        let out = format_csv_with_quote_mode(
            &["id".to_string(), "district,name".to_string(), "note".to_string()],
            &[
                vec![json!(2085252644_u64), json!("延庆县"), json!("plain")],
                vec![json!(2085252645_u64), json!("门头沟区"), json!("line 1\n\"line 2\"")],
            ],
            CsvQuoteMode::Necessary,
        );
        assert_eq!(
            out,
            "id,\"district,name\",note\n2085252644,延庆县,plain\n2085252645,门头沟区,\"line 1\n\"\"line 2\"\"\""
        );
    }

    #[test]
    fn csv_quote_mode_defaults_to_all_for_backward_compatibility() {
        assert_eq!(CsvQuoteMode::default(), CsvQuoteMode::All);
    }

    #[test]
    fn semicolon_delimiter_separates_and_quotes_only_delimiter_occurrences() {
        let out = super::format_csv_with_format(
            &["id".to_string(), "comma".to_string(), "semi".to_string()],
            &[
                vec![json!(1), json!("a,b"), json!("x;y")],
                vec![json!(2), json!("line 1\n\"line 2\""), json!("plain")],
            ],
            super::CsvTextFormat { quote_mode: CsvQuoteMode::Necessary, delimiter: ';', ..Default::default() },
        );
        // 逗号不再触发引号（它不再是分隔符）；分号/引号/换行仍按需加引号。
        assert_eq!(out, "id;comma;semi\n1;a,b;\"x;y\"\n2;\"line 1\n\"\"line 2\"\"\";plain");
    }

    #[test]
    fn never_quote_mode_writes_fields_raw_even_with_special_characters() {
        let out = super::format_csv_with_format(
            &["a,b".to_string(), "plain".to_string()],
            &[vec![json!("line 1\n\"line 2\""), json!(Value::Null)]],
            super::CsvTextFormat { quote_mode: CsvQuoteMode::Never, delimiter: ',', ..Default::default() },
        );
        // Never 显式不转义：含逗号的表头/含换行的值原样输出，会与结构字符
        // 混在一起（空单元格为裸空）。这正是该模式的风险，由用户自担。
        assert_eq!(out, "a,b,plain\nline 1\n\"line 2\",");
    }

    #[test]
    fn never_quote_mode_deserializes_from_camel_case_json() {
        assert_eq!(serde_json::from_str::<CsvQuoteMode>("\"never\"").unwrap(), CsvQuoteMode::Never);
        assert_eq!(serde_json::from_str::<CsvQuoteMode>("\"necessary\"").unwrap(), CsvQuoteMode::Necessary);
    }

    #[test]
    fn resolve_csv_delimiter_takes_the_first_character_and_falls_back_to_comma() {
        assert_eq!(super::resolve_csv_delimiter(";"), ';');
        assert_eq!(super::resolve_csv_delimiter("\t"), '\t');
        assert_eq!(super::resolve_csv_delimiter(""), ',');
        assert_eq!(super::resolve_csv_delimiter(";;"), ';');
    }

    #[test]
    fn custom_quote_character_wraps_and_doubles_itself() {
        let out = super::format_csv_with_format(
            &["id".to_string(), "name".to_string()],
            &[vec![json!(1), json!("O'Brien"), json!("plain")]],
            super::CsvTextFormat { quote_mode: CsvQuoteMode::All, delimiter: ',', quote_char: '\'', ..Default::default() },
        );
        // 引号字符换成 ' 后：包裹用它、内部出现时翻倍；默认的 " 退化为普通字符。
        assert_eq!(out, "'id','name'\n'1','O''Brien','plain'");
    }

    #[test]
    fn necessary_mode_quotes_custom_quote_char_and_delimiter_but_not_default_quotes() {
        let out = super::format_csv_with_format(
            &["id".to_string(), "note".to_string()],
            &[vec![json!(7), json!("it's a, \"test\"")]],
            super::CsvTextFormat { quote_mode: CsvQuoteMode::Necessary, delimiter: ',', quote_char: '\'', ..Default::default() },
        );
        // `'` 触发引号（自定义引号字符）、`,` 触发（分隔符）；`"` 不再触发。
        assert_eq!(out, "id,note\n7,'it''s a, \"test\"'");
    }

    #[test]
    fn include_header_false_omits_the_header_row() {
        let out = super::format_csv_with_format(
            &["id".to_string(), "name".to_string()],
            &[vec![json!(1), json!("Ada")], vec![json!(2), json!("Bob")]],
            super::CsvTextFormat { include_header: false, ..Default::default() },
        );
        assert_eq!(out, "\"1\",\"Ada\"\n\"2\",\"Bob\"");
    }

    #[test]
    fn include_header_false_with_no_rows_yields_empty_output() {
        let out = super::format_csv_with_format(
            &["id".to_string(), "name".to_string()],
            &[],
            super::CsvTextFormat { include_header: false, ..Default::default() },
        );
        assert_eq!(out, "");
    }

    #[test]
    fn resolve_csv_quote_char_takes_the_first_character_and_falls_back_to_double_quote() {
        assert_eq!(super::resolve_csv_quote_char("'"), '\'');
        assert_eq!(super::resolve_csv_quote_char("`"), '`');
        assert_eq!(super::resolve_csv_quote_char(""), '"');
        assert_eq!(super::resolve_csv_quote_char("''"), '\'');
    }

    #[test]
    fn table_csv_rows_keep_quoted_nulls_in_all_mode_with_custom_delimiter() {
        let mut out = String::new();
        super::push_table_csv_row_with_format(
            &mut out,
            &[Value::Null, json!("NULL"), json!("tab\there")],
            super::CsvTextFormat { quote_mode: CsvQuoteMode::All, delimiter: '\t', ..Default::default() },
        );
        assert_eq!(out, "\"\"\t\"NULL\"\t\"tab\there\"");
    }

    #[test]
    fn formats_streamed_query_result_null_as_empty_cell_and_preserves_literal_null() {
        let out = format_query_result_csv_rows(&[vec![Value::Null, json!("NULL"), json!("")]]);
        assert_eq!(out, ",\"NULL\",\"\"");
    }

    #[test]
    fn formats_tsv_with_empty_null_and_escaped_special_values() {
        let out = format_tsv(
            &["id".to_string(), "note".to_string()],
            &[vec![json!(1), Value::Null], vec![json!(2), json!("line1\n\"line2\"")]],
        );
        assert_eq!(out, "id\tnote\n1\t\n2\t\"line1\n\"\"line2\"\"\"");
    }

    #[test]
    fn capacity_estimate_sums_actual_cells_across_ragged_rows() {
        // 不等宽行按实际单元格数求和，不得按首行宽度放大
        let wide_first = vec![vec![serde_json::Value::Null; 1000], vec![], vec![serde_json::Value::Null]];
        assert_eq!(super::estimated_rows_capacity(&wide_first), 1001 * 12);
        assert!(super::estimated_rows_capacity(&[]) == 0);
    }

    #[test]
    fn escape_tsv_matches_reference_semantics() {
        // TSV 仅在含 \t/\n/\r/引号时包引号；逗号不触发
        for input in ["", "plain", "with,comma", "tab\there", "line\nbreak", "cr\rhere", "quo\"te", "\t\"mix\""] {
            let expected =
                if input.contains('\t') || input.contains('\n') || input.contains('\r') || input.contains('"') {
                    format!("\"{}\"", input.replace('"', "\"\""))
                } else {
                    input.to_string()
                };
            assert_eq!(super::escape_tsv(input), expected, "input: {input:?}");
        }
    }

    #[test]
    fn push_csv_escaped_matches_replace_reference() {
        // 直写实现必须与原 replace 版本逐字节等价（含引号在首/尾/连续的边界）
        for input in ["", "plain", "\"", "\"\"", "a\"b", "\"start", "end\"", "mid\"\"dle", "逗,号\n换行"] {
            let expected = format!("\"{}\"", input.replace('"', "\"\""));
            assert_eq!(super::escape_csv(input), expected, "input: {input:?}");
        }
    }

    #[test]
    fn push_csv_text_value_preserves_paginated_export_semantics() {
        let cases = [
            (serde_json::Value::Null, "\"\""),
            (serde_json::json!(true), "\"true\""),
            (serde_json::json!(42.5), "\"42.5\""),
            (serde_json::json!("a\"b"), "\"a\"\"b\""),
            (serde_json::json!({"key": "value"}), "\"{\"\"key\"\":\"\"value\"\"}\""),
        ];

        for (value, expected) in cases {
            let mut out = String::from("prefix,");
            super::push_csv_text_value(&mut out, &value);
            assert_eq!(out, format!("prefix,{expected}"));
        }
    }

    #[test]
    fn reusable_row_buffers_match_batch_formatters() {
        let row = vec![Value::Null, json!("NULL"), json!("line\n\"two\""), json!(42)];

        let mut csv = String::new();
        super::push_query_result_csv_row(&mut csv, &row);
        assert_eq!(csv, super::format_query_result_csv_rows(std::slice::from_ref(&row)));

        let mut table_csv = String::new();
        super::push_table_csv_row(&mut table_csv, &row);
        assert_eq!(table_csv, "\"\",\"NULL\",\"line\n\"\"two\"\"\",\"42\"");

        let mut tsv = String::new();
        super::push_tsv_row(&mut tsv, &row);
        assert_eq!(tsv, super::format_tsv_rows(&[row]));
    }

    use serde_json::Value;
}
