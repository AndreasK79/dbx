import * as api from "@/lib/backend/api";
import { isTauriRuntime } from "@/lib/backend/tauriRuntime";
import { isWindows } from "@/lib/backend/platform";
import type { ConnectionConfig } from "@/types/database";

/**
 * Windows VPN dialing for connections behind a RAS VPN profile (#63).
 *
 * The connection names a phonebook entry in `vpn_profile`; DBX dials it via
 * rasdial before the first connect attempt and before every reconnect/test.
 * An already-connected profile (dialed by the user, by Windows, or by an
 * earlier DBX connection) is left alone — DBX never hangs up a VPN: other
 * apps may be riding it, so teardown stays a manual action in the dialog.
 */

/** The dial budget `run_rasdial` allows on the backend (seconds). */
export const VPN_DIAL_TIMEOUT_SECS = 120;

export function isVpnControlAvailable(globalObject: Record<string, unknown> = globalThis as Record<string, unknown>): boolean {
  return isTauriRuntime(globalObject) && isWindows();
}

export function connectionVpnProfile(config: Pick<ConnectionConfig, "vpn_profile">): string {
  return (config.vpn_profile ?? "").trim();
}

function profileIsConnected(connected: string[], profile: string): boolean {
  const wanted = profile.toLowerCase();
  return connected.some((name) => name.trim().toLowerCase() === wanted);
}

/**
 * Bring the connection's VPN profile up if it is not already connected.
 * Throws with rasdial's own message when dialing fails, so the connect/test
 * error surfaces name the VPN instead of the unreachable database behind it.
 */
export async function ensureConnectionVpnProfile(config: Pick<ConnectionConfig, "vpn_profile">): Promise<void> {
  const profile = connectionVpnProfile(config);
  if (!profile) return;
  if (!isVpnControlAvailable()) return;
  const state = await api.vpnProfiles();
  if (profileIsConnected(state.connected, profile)) return;
  try {
    await api.vpnConnect(profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`VPN "${profile}" could not be connected: ${message}`);
  }
}
