import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectionVpnProfile, ensureConnectionVpnProfile, isVpnControlAvailable } from "@/lib/connection/vpnProfile";
import type { ConnectionConfig } from "@/types/database";

const vpnProfiles = vi.fn();
const vpnConnect = vi.fn();

vi.mock("@/lib/backend/api", () => ({
  vpnProfiles: (...args: unknown[]) => vpnProfiles(...args),
  vpnConnect: (...args: unknown[]) => vpnConnect(...args),
}));

const runtimeMock = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/backend/tauriRuntime", () => ({
  isTauriRuntime: () => runtimeMock.value,
}));

const platformMock = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/backend/platform", () => ({
  isWindows: () => platformMock.value,
}));

function config(vpnProfile?: string): Pick<ConnectionConfig, "vpn_profile"> {
  return { vpn_profile: vpnProfile };
}

beforeEach(() => {
  vpnProfiles.mockReset();
  vpnConnect.mockReset();
  runtimeMock.value = true;
  platformMock.value = true;
});

describe("connectionVpnProfile", () => {
  it("trims and defaults to empty", () => {
    expect(connectionVpnProfile(config())).toBe("");
    expect(connectionVpnProfile(config("  Work VPN  "))).toBe("Work VPN");
  });
});

describe("isVpnControlAvailable", () => {
  it("requires the desktop runtime and Windows", () => {
    runtimeMock.value = true;
    platformMock.value = true;
    expect(isVpnControlAvailable()).toBe(true);
    platformMock.value = false;
    expect(isVpnControlAvailable()).toBe(false);
    platformMock.value = true;
    runtimeMock.value = false;
    expect(isVpnControlAvailable()).toBe(false);
  });
});

describe("ensureConnectionVpnProfile", () => {
  it("never touches the backend without a profile", async () => {
    await ensureConnectionVpnProfile(config(undefined));
    await ensureConnectionVpnProfile(config("   "));
    expect(vpnProfiles).not.toHaveBeenCalled();
    expect(vpnConnect).not.toHaveBeenCalled();
  });

  it("dials a disconnected profile before proceeding", async () => {
    vpnProfiles.mockResolvedValue({ profiles: ["Work VPN"], connected: [] });
    vpnConnect.mockResolvedValue("Connected to Work VPN");
    await ensureConnectionVpnProfile(config("Work VPN"));
    expect(vpnConnect).toHaveBeenCalledWith("Work VPN");
  });

  it("skips dialing when the profile is already connected, case-insensitively", async () => {
    vpnProfiles.mockResolvedValue({ profiles: ["Work VPN"], connected: [" work vpn "] });
    await ensureConnectionVpnProfile(config("Work VPN"));
    expect(vpnConnect).not.toHaveBeenCalled();
  });

  it("is a silent no-op in the web build", async () => {
    runtimeMock.value = false;
    await ensureConnectionVpnProfile(config("Work VPN"));
    expect(vpnProfiles).not.toHaveBeenCalled();
  });

  it("throws with the profile name and rasdial message when dialing fails", async () => {
    vpnProfiles.mockResolvedValue({ profiles: ["Work VPN"], connected: [] });
    vpnConnect.mockRejectedValue(new Error("Remote Access error 691."));
    await expect(ensureConnectionVpnProfile(config("Work VPN"))).rejects.toThrow('VPN "Work VPN" could not be connected: Remote Access error 691.');
  });

  it("propagates status-probe failures", async () => {
    vpnProfiles.mockRejectedValue(new Error("rasdial did not finish within 15s"));
    await expect(ensureConnectionVpnProfile(config("Work VPN"))).rejects.toThrow("rasdial did not finish within 15s");
  });
});
