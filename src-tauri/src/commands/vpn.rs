//! Windows VPN (RAS) control via `rasdial.exe`.
//!
//! A connection can name a phonebook VPN profile (`vpn_profile`); the frontend
//! dials it before connecting (`ensureConnectionVpnProfile`). The commands here
//! are the whole backend surface: list phonebook profiles, report which are
//! connected, dial, and hang up. Non-Windows builds answer every command with
//! an error so the shared frontend never needs a platform split.
//!
//! `rasdial` itself is credential-free from DBX's side: profiles authenticate
//! with the credentials cached in the Windows phonebook entry. VPN clients that
//! do not register a RAS phonebook entry (WireGuard service mode, vendor
//! clients with their own daemons) are simply not listed and not controllable.

use std::time::Duration;

use serde::Serialize;

/// How long a dial attempt may run before DBX gives up on it. EAP handshakes
/// against a slow VPN server routinely take tens of seconds; the frontend's
/// attempt-timeout budget carries the same number as its VPN dial buffer.
pub(crate) const VPN_CONNECT_TIMEOUT_SECS: u64 = 120;
const VPN_DISCONNECT_TIMEOUT_SECS: u64 = 30;
const VPN_LIST_TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct VpnProfileState {
    /// Phonebook entry names from the per-user and all-user `rasphone.pbk`.
    pub profiles: Vec<String>,
    /// Entry names rasdial currently reports as connected.
    pub connected: Vec<String>,
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
async fn run_rasdial(args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut command = tokio::process::Command::new("rasdial.exe");
    command.args(args).creation_flags(CREATE_NO_WINDOW);
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| format!("rasdial did not finish within {}s", timeout.as_secs()))?
        .map_err(|error| format!("Failed to run rasdial: {error}"))?;
    let stdout = decode_console_bytes(&output.stdout);
    let stderr = decode_console_bytes(&output.stderr);
    if !output.status.success() {
        let message = [stdout.trim(), stderr.trim()]
            .iter()
            .filter(|text| !text.is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(if message.is_empty() { format!("rasdial exited with {}", output.status) } else { message });
    }
    Ok(stdout.trim().to_string())
}

/// Console tools on Windows emit the OEM/ANSI codepage, not UTF-8 (nb-NO:
/// CP850). Try strict UTF-8 first, then fall back to windows-1252 so at least
/// error text stays readable instead of turning into replacement characters.
#[cfg(windows)]
fn decode_console_bytes(bytes: &[u8]) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    let (text, _, _) = encoding_rs::WINDOWS_1252.decode(bytes);
    text.into_owned()
}

#[cfg(not(windows))]
async fn run_rasdial(_args: &[&str], _timeout: Duration) -> Result<String, String> {
    Err("Windows VPN control is only available on Windows".to_string())
}

/// `rasdial` with no arguments prints a header line, one line per connected
/// entry, a blank line, and a trailer. Parse defensively: only lines between
/// the header and the first blank/trailer line are entry names.
pub(crate) fn parse_connected_profiles(stdout: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut in_list = false;
    for line in stdout.lines() {
        let trimmed = line.trim();
        if !in_list {
            if trimmed.eq_ignore_ascii_case("Connected to") {
                in_list = true;
            }
            continue;
        }
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("Command completed successfully.") {
            break;
        }
        names.push(trimmed.to_string());
    }
    names
}

/// Phonebook entries are INI section headers (`[Work VPN]`). Profile names may
/// contain spaces; brackets themselves are not legal in RAS entry names.
pub(crate) fn parse_phonebook_profiles(content: &str) -> Vec<String> {
    content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if !trimmed.starts_with('[') || !trimmed.ends_with(']') || trimmed.len() < 3 {
                return None;
            }
            let name = trimmed[1..trimmed.len() - 1].trim();
            (!name.is_empty()).then(|| name.to_string())
        })
        .collect()
}

#[cfg(windows)]
fn phonebook_paths() -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        paths.push(std::path::Path::new(&appdata).join(r"Microsoft\Network\Connections\Pbk\rasphone.pbk"));
    }
    if let Ok(program_data) = std::env::var("ProgramData") {
        paths.push(std::path::Path::new(&program_data).join(r"Microsoft\Network\Connections\Pbk\rasphone.pbk"));
    }
    paths
}

/// Read a phonebook in its stored encoding: modern files are UTF-16LE with a
/// BOM, older ones ANSI (windows-1252).
#[cfg(windows)]
fn read_phonebook(path: &std::path::Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let (text, _, _) = encoding_rs::UTF_16LE.decode(&bytes[2..]);
        return Some(text.into_owned());
    }
    if let Ok(text) = std::str::from_utf8(&bytes) {
        return Some(text.to_string());
    }
    let (text, _, _) = encoding_rs::WINDOWS_1252.decode(&bytes);
    Some(text.into_owned())
}

#[tauri::command]
pub async fn vpn_profiles() -> Result<VpnProfileState, String> {
    vpn_profiles_impl().await
}

async fn vpn_profiles_impl() -> Result<VpnProfileState, String> {
    #[cfg(windows)]
    {
        // A bare-rasdial status probe must not blank the phonebook list: the
        // profiles are still selectable and dialable, only the live connected
        // state is unknown (machines that lock down rasdial still list fine).
        let connected = match run_rasdial(&[], Duration::from_secs(VPN_LIST_TIMEOUT_SECS)).await {
            Ok(status) => parse_connected_profiles(&status),
            Err(_) => Vec::new(),
        };
        let mut profiles: Vec<String> = Vec::new();
        for path in phonebook_paths() {
            if let Some(content) = read_phonebook(&path) {
                profiles.extend(parse_phonebook_profiles(&content));
            }
        }
        for name in &connected {
            if !profiles.iter().any(|profile| profile.eq_ignore_ascii_case(name)) {
                profiles.push(name.clone());
            }
        }
        profiles.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        profiles.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
        Ok(VpnProfileState { profiles, connected })
    }
    #[cfg(not(windows))]
    {
        run_rasdial(&[], Duration::from_secs(VPN_LIST_TIMEOUT_SECS)).await?;
        unreachable!("non-Windows run_rasdial always errors")
    }
}

#[tauri::command]
pub async fn vpn_connect(profile: String) -> Result<String, String> {
    let profile = profile.trim();
    if profile.is_empty() {
        return Err("No VPN profile name given".to_string());
    }
    run_rasdial(&[profile], Duration::from_secs(VPN_CONNECT_TIMEOUT_SECS)).await
}

#[tauri::command]
pub async fn vpn_disconnect(profile: String) -> Result<String, String> {
    let profile = profile.trim();
    if profile.is_empty() {
        return Err("No VPN profile name given".to_string());
    }
    run_rasdial(&[profile, "/d"], Duration::from_secs(VPN_DISCONNECT_TIMEOUT_SECS)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_connected_entries_from_bare_rasdial_output() {
        let output = "Connected to\n Work VPN\n\nCommand completed successfully.\r\n";
        assert_eq!(parse_connected_profiles(output), vec!["Work VPN".to_string()]);
    }

    #[test]
    fn parses_multiple_connected_entries() {
        let output = "Connected to\r\nWork VPN\r\nClient Site\r\n\r\nCommand completed successfully.";
        assert_eq!(parse_connected_profiles(output), vec!["Work VPN".to_string(), "Client Site".to_string()]);
    }

    #[test]
    fn no_connections_output_yields_no_entries() {
        // Disconnected state prints neither the header nor entries; whatever
        // the exact wording, only the header opens the name list.
        assert!(parse_connected_profiles("No connections\r\nCommand completed successfully.").is_empty());
        assert!(parse_connected_profiles("").is_empty());
    }

    #[test]
    fn ignores_connected_to_inside_a_name() {
        let output = "Connected to\nVPN Connected To Elsewhere\n\nCommand completed successfully.";
        assert_eq!(parse_connected_profiles(output), vec!["VPN Connected To Elsewhere".to_string()]);
    }

    #[test]
    fn parses_phonebook_sections_and_skips_keys() {
        let content = "[Work VPN]\nEncoding=1\nType=2\n\n[Client Site]\nEncoding=1\n";
        assert_eq!(parse_phonebook_profiles(content), vec!["Work VPN".to_string(), "Client Site".to_string()]);
    }

    #[test]
    fn empty_and_malformed_sections_are_skipped() {
        assert!(parse_phonebook_profiles("[]\nplain text\n[x").is_empty());
    }

    #[test]
    #[cfg(windows)]
    fn phonebook_reading_handles_utf16_bom() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("rasphone.pbk");
        let utf16: Vec<u8> = "\u{feff}[Kontor VPN]\n".encode_utf16().flat_map(|unit| unit.to_le_bytes()).collect();
        std::fs::write(&path, utf16).unwrap();
        let content = read_phonebook(&path).unwrap();
        assert_eq!(parse_phonebook_profiles(&content), vec!["Kontor VPN".to_string()]);
    }
}
