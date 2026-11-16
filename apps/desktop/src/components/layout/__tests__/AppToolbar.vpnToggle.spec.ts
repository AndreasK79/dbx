// @vitest-environment happy-dom
import { createApp, nextTick, type Component } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/backend/tauriRuntime", () => ({ isTauriRuntime: () => true }));
vi.mock("@/lib/backend/platform", () => ({ isWindows: () => true, isMacOS: () => false, isLinux: () => false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getAllWebviewWindows: vi.fn(async () => []),
  WebviewWindow: { getByLabel: vi.fn(async () => null) },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    isMaximized: async () => false,
    isFullscreen: async () => false,
    isAlwaysOnTop: async () => false,
    setAlwaysOnTop: async () => {},
    onResized: async () => () => {},
    onFocusChanged: async () => () => {},
    minimize: async () => {},
    toggleMaximize: async () => {},
  }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: { name: "ButtonStub", props: ["disabled"], template: `<button :disabled="disabled" @click="$emit('click')"><slot /></button>` },
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: { name: "TooltipStub", template: `<span><slot /></span>` },
  TooltipTrigger: { name: "TooltipTriggerStub", template: `<span><slot /></span>` },
  TooltipContent: { name: "TooltipContentStub", template: `<span><slot /></span>` },
}));
vi.mock("@/components/ui/LightDropdown.vue", () => ({
  default: { name: "LightDropdownStub", template: `<div />` },
}));
vi.mock("@/components/layout/WindowControls.vue", () => ({
  default: { name: "WindowControlsStub", template: `<div />` },
}));
vi.mock("@/components/export/ExportProgressPopover.vue", () => ({
  default: { name: "ExportProgressPopoverStub", template: `<div />` },
}));
vi.mock("@/components/layout/ToolbarUpdateIcon.vue", () => ({
  default: { name: "ToolbarUpdateIconStub", template: `<span data-toolbar-update-idle />` },
}));

const vpnProfilesMock = vi.fn();
const vpnConnectMock = vi.fn();
const vpnDisconnectMock = vi.fn();
const vpnOpenNetworkFlyoutMock = vi.fn();
vi.mock("@/lib/backend/api", () => ({
  vpnProfiles: (...args: unknown[]) => vpnProfilesMock(...args),
  vpnConnect: (...args: unknown[]) => vpnConnectMock(...args),
  vpnDisconnect: (...args: unknown[]) => vpnDisconnectMock(...args),
  vpnOpenNetworkFlyout: (...args: unknown[]) => vpnOpenNetworkFlyoutMock(...args),
}));

const toastMock = vi.fn();
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const connectionStoreMock = vi.hoisted(() => ({
  activeConnectionId: null as string | null,
  getConfig: vi.fn((): Record<string, unknown> => ({})),
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: () => connectionStoreMock,
}));

import AppToolbar from "../AppToolbar.vue";

const defaultToolbarProps = {
  isDark: false,
  themeMode: "system" as const,
  showSidebarExpand: false,
  showAiPanel: false,
  activeAiRunCount: 0,
  awaitingAiRunCount: 0,
  showHistory: false,
  showSqlLibrary: false,
  sqlLibrarySaveFeedbackId: 0,
  showSqlFilePanel: false,
  showDriverStore: false,
  showPluginCenter: false,
  showSettingsPage: false,
  checkingUpdates: false,
  hasUpdateAvailable: false,
  isDownloadingUpdate: false,
  downloadProgress: null,
  updateReadyToInstall: false,
  updateReady: false,
  agentDriverUpdateCount: 0,
  hasMcpUpdateAvailable: false,
  hasConnections: false,
  canNewQuery: false,
  hasSqlFileConnections: false,
  immediateSyncing: false,
};

let pinia: ReturnType<typeof createPinia>;
let mounted: { host: HTMLDivElement; unmount: () => void } | null = null;

function mount(props: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(AppToolbar as unknown as Component, {
    ...defaultToolbarProps,
    ...props,
  });
  app.use(pinia);
  app.use(
    createI18n({
      legacy: false,
      locale: "en",
      missingWarn: false,
      fallbackWarn: false,
      messages: {
        en: {
          settings: { title: "Settings" },
          toolbar: {
            theme: "Theme",
            newConnection: "New Connection",
            vpnConnect: "Connect VPN",
            vpnDisconnect: "Disconnect VPN",
          },
          connection: {
            vpnExternalClientHint: '"{profile}" is not a native Windows VPN entry',
            vpnOpenedNetworkFlyout: 'No phonebook entry for "{profile}" — opened the Windows network panel; click the profile there',
          },
          updates: { check: "Check for updates", updateAction: "Update" },
          exportProgress: { tooltip: "Export" },
        },
      },
    }),
  );
  app.mount(host);
  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

function vpnButton(): HTMLButtonElement | null {
  return mounted?.host.querySelector<HTMLButtonElement>('[data-testid="toolbar-vpn-toggle"]') ?? null;
}

async function settle() {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

describe("AppToolbar VPN toggle (mod 63)", () => {
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vpnProfilesMock.mockReset().mockResolvedValue({ profiles: [], connected: [] });
    vpnConnectMock.mockReset().mockResolvedValue("Connected");
    vpnDisconnectMock.mockReset().mockResolvedValue("Disconnected");
    toastMock.mockReset();
    connectionStoreMock.activeConnectionId = null;
    connectionStoreMock.getConfig.mockReset().mockReturnValue({});
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it("hides the VPN button when no connection is active", async () => {
    mounted = mount();
    await settle();
    expect(vpnButton()).toBeNull();
  });

  it("hides the VPN button when the active connection has no profile", async () => {
    connectionStoreMock.activeConnectionId = "c1";
    connectionStoreMock.getConfig.mockReturnValue({ vpn_profile: "" });
    mounted = mount();
    await settle();
    expect(vpnButton()).toBeNull();
  });

  it("dials the active connection's profile from the toolbar", async () => {
    connectionStoreMock.activeConnectionId = "c1";
    connectionStoreMock.getConfig.mockReturnValue({ vpn_profile: "Work VPN" });
    mounted = mount();
    await settle();
    const button = vpnButton();
    expect(button).not.toBeNull();
    expect(button!.textContent).toContain("Connect VPN");
    button!.click();
    await settle();
    expect(vpnConnectMock).toHaveBeenCalledWith("Work VPN");
    expect(vpnDisconnectMock).not.toHaveBeenCalled();
  });

  it("hangs up when the profile is already connected", async () => {
    connectionStoreMock.activeConnectionId = "c1";
    connectionStoreMock.getConfig.mockReturnValue({ vpn_profile: "Work VPN" });
    vpnProfilesMock.mockResolvedValue({ profiles: ["Work VPN"], connected: ["Work VPN"] });
    mounted = mount();
    await settle();
    const button = vpnButton();
    expect(button!.textContent).toContain("Disconnect VPN");
    button!.click();
    await settle();
    expect(vpnDisconnectMock).toHaveBeenCalledWith("Work VPN");
    expect(vpnConnectMock).not.toHaveBeenCalled();
  });

  it("opens the Windows network flyout when the dial reports 623", async () => {
    connectionStoreMock.activeConnectionId = "c1";
    connectionStoreMock.getConfig.mockReturnValue({ vpn_profile: "Azure VPN" });
    vpnConnectMock.mockRejectedValue(new Error("Remote Access error 623 - The system could not find the phone book entry for this connection."));
    vpnOpenNetworkFlyoutMock.mockReset().mockResolvedValue(undefined);
    mounted = mount();
    await settle();
    vpnButton()!.click();
    await settle();
    expect(vpnConnectMock).toHaveBeenCalledWith("Azure VPN");
    expect(vpnOpenNetworkFlyoutMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining("opened the Windows network panel"), 6000);
  });

  it("falls back to the hint toast when the flyout cannot be opened", async () => {
    connectionStoreMock.activeConnectionId = "c1";
    connectionStoreMock.getConfig.mockReturnValue({ vpn_profile: "Azure VPN" });
    vpnConnectMock.mockRejectedValue(new Error("Remote Access error 623 - The system could not find the phone book entry for this connection."));
    vpnOpenNetworkFlyoutMock.mockReset().mockRejectedValue(new Error("explorer blocked"));
    mounted = mount();
    await settle();
    vpnButton()!.click();
    await settle();
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining("not a native Windows VPN entry"), 6000);
  });
});
