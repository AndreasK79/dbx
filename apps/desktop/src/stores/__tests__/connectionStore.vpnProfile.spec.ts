import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { ConnectionConfig } from "@/types/database";

function installLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => data.set(key, value)),
    removeItem: vi.fn((key: string) => data.delete(key)),
  });
}

function postgresConnection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: "pg-1",
    name: "Behind VPN",
    db_type: "postgres",
    host: "10.8.0.5",
    port: 5432,
    username: "postgres",
    password: "secret",
    database: "app",
    ...overrides,
  } as ConnectionConfig;
}

// The VPN dial rides the desktop runtime on Windows; everything else about the
// connect path is the stock mock surface from the sibling store specs.
function mockBackend(overrides: Record<string, unknown> = {}) {
  vi.doMock("@/lib/backend/tauriRuntime", () => ({ isTauriRuntime: () => true }));
  vi.doMock("@/lib/backend/platform", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isWindows: () => true,
  }));
  vi.doMock("@/lib/backend/api", () => ({
    checkConnectionHealth: vi.fn().mockRejectedValue(new Error("back end pool is gone")),
    connectDb: vi.fn().mockResolvedValue("pg-1"),
    deleteSchemaCachePrefix: vi.fn().mockResolvedValue(undefined),
    listInstalledAgents: vi.fn().mockResolvedValue([]),
    loadSchemaCache: vi.fn().mockResolvedValue(null),
    saveConnections: vi.fn().mockResolvedValue(undefined),
    saveSchemaCache: vi.fn().mockResolvedValue(undefined),
    saveSidebarLayout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }));
}

describe("connectionStore VPN dialing (#63)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    installLocalStorage();
    setActivePinia(createPinia());
    i18n.global.locale.value = "en";
  });

  it("dials a disconnected VPN profile before connectDb", async () => {
    const vpnProfiles = vi.fn().mockResolvedValue({ profiles: ["Work VPN"], connected: [] });
    const vpnConnect = vi.fn().mockResolvedValue("Connected to Work VPN");
    const connectDb = vi.fn().mockResolvedValue("pg-1");
    mockBackend({ vpnProfiles, vpnConnect, connectDb });

    const { useConnectionStore } = await import("@/stores/connectionStore");
    const store = useConnectionStore();
    const connection = postgresConnection({ vpn_profile: "Work VPN" });

    await expect(store.connect(connection)).resolves.toBe("pg-1");
    expect(vpnConnect).toHaveBeenCalledWith("Work VPN");
    expect(connectDb).toHaveBeenCalledTimes(1);
    expect(vpnConnect.mock.invocationCallOrder[0]).toBeLessThan(connectDb.mock.invocationCallOrder[0]);
  }, 15_000);

  it("does not redial a profile that is already connected", async () => {
    const vpnProfiles = vi.fn().mockResolvedValue({ profiles: ["Work VPN"], connected: ["work vpn"] });
    const vpnConnect = vi.fn();
    const connectDb = vi.fn().mockResolvedValue("pg-1");
    mockBackend({ vpnProfiles, vpnConnect, connectDb });

    const { useConnectionStore } = await import("@/stores/connectionStore");
    const store = useConnectionStore();
    await expect(store.connect(postgresConnection({ vpn_profile: "Work VPN" }))).resolves.toBe("pg-1");
    expect(vpnConnect).not.toHaveBeenCalled();
  }, 15_000);

  it("fails the connect with the VPN error and never reaches the database", async () => {
    const vpnProfiles = vi.fn().mockResolvedValue({ profiles: ["Work VPN"], connected: [] });
    const vpnConnect = vi.fn().mockRejectedValue(new Error("Remote Access error 691."));
    const connectDb = vi.fn();
    mockBackend({ vpnProfiles, vpnConnect, connectDb });

    const { useConnectionStore } = await import("@/stores/connectionStore");
    const store = useConnectionStore();
    const connection = postgresConnection({ vpn_profile: "Work VPN" });

    await expect(store.connect(connection)).rejects.toThrow('VPN "Work VPN" could not be connected: Remote Access error 691.');
    expect(connectDb).not.toHaveBeenCalled();
    expect(store.connectionErrors["pg-1"]).toContain('VPN "Work VPN" could not be connected');
  }, 15_000);

  it("leaves the backend untouched for connections without a VPN profile", async () => {
    const vpnProfiles = vi.fn();
    const connectDb = vi.fn().mockResolvedValue("pg-1");
    mockBackend({ vpnProfiles, connectDb });

    const { useConnectionStore } = await import("@/stores/connectionStore");
    const store = useConnectionStore();
    await expect(store.connect(postgresConnection())).resolves.toBe("pg-1");
    expect(vpnProfiles).not.toHaveBeenCalled();
  }, 15_000);
});
