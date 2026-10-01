import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyzeEditableQueryEditability: vi.fn(),
  beginManualTransaction: vi.fn(),
  closeClientConnectionSession: vi.fn(),
  closeQuerySession: vi.fn(),
  executeInManualTransaction: vi.fn(),
  executeMulti: vi.fn(),
  executeMultiWithProgress: vi.fn(),
  getConnectionConfig: vi.fn(),
  prepareQueryPaginationExecutionPlan: vi.fn(),
  saveOpenTabsState: vi.fn(),
  withStatementNotices: vi.fn(),
}));

vi.mock("@/lib/backend/api", () => ({
  analyzeEditableQueryEditability: mocks.analyzeEditableQueryEditability,
  beginManualTransaction: mocks.beginManualTransaction,
  closeClientConnectionSession: mocks.closeClientConnectionSession,
  closeQuerySession: mocks.closeQuerySession,
  executeInManualTransaction: mocks.executeInManualTransaction,
  executeMulti: mocks.executeMulti,
  executeMultiWithProgress: mocks.executeMultiWithProgress,
  prepareQueryPaginationExecutionPlan: mocks.prepareQueryPaginationExecutionPlan,
  saveOpenTabsState: mocks.saveOpenTabsState,
  withStatementNotices: mocks.withStatementNotices,
}));

vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: () => ({
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    getConfig: mocks.getConnectionConfig,
    recordConnectionLostError: vi.fn(),
  }),
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({
    editorSettings: {
      autoCalculateTotalRows: false,
      continueOnErrorOnBatch: false,
      pageSize: 100,
      queryResultMaxRowsEnabled: false,
      queryResultMaxRows: 1000,
      openTabsRestoreMode: "all",
      confirmUnsavedSqlClose: false,
    },
  }),
}));

function installLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => data.set(key, value)),
    removeItem: vi.fn((key: string) => data.delete(key)),
  });
}

function successSelect(statementIndex: number) {
  return { columns: ["VALUE"], rows: [[1]], affected_rows: 0, execution_time_ms: 1, statement_index: statementIndex };
}

function errorResult(statementIndex: number) {
  return { columns: ["Error"], rows: [["ERROR: boom"]], affected_rows: 0, execution_time_ms: 1, execution_error: true, statement_index: statementIndex };
}

/** Blocks the backend call until the test releases it, so mid-run state is observable. */
function deferredExecution() {
  let resolve!: (results: unknown[]) => void;
  const promise = new Promise<unknown[]>((res) => (resolve = res));
  return { promise, resolve };
}

async function bootstrapStore() {
  const { useQueryStore } = await import("@/stores/queryStore");
  const store = useQueryStore();
  const tabId = store.createTab("pg-1", "app", "Query", "query", "public");
  return { store, tabId };
}

describe("queryStore error visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    installLocalStorage();
    setActivePinia(createPinia());
    mocks.getConnectionConfig.mockReturnValue({
      id: "pg-1",
      name: "Postgres",
      db_type: "postgres",
      database: "app",
      query_timeout_secs: 30,
    });
    mocks.prepareQueryPaginationExecutionPlan.mockImplementation(async (options: { sql: string }) => ({
      sqlToExecute: options.sql,
      pageSql: undefined,
      pageLimit: undefined,
      pageOffset: undefined,
      countSql: undefined,
      useAgentResultSession: false,
    }));
    mocks.analyzeEditableQueryEditability.mockResolvedValue({ editable: false, reason: "not-select" });
    mocks.saveOpenTabsState.mockResolvedValue(undefined);
    mocks.withStatementNotices.mockImplementation(async (_executionId: string, _onStatementNotices: (event: unknown) => void, run: () => Promise<unknown>) => run());
  });

  it("flips the view to summary on the first mid-batch statement error, once per run", async () => {
    const deferred = deferredExecution();
    let onProgress: ((progress: unknown) => void) | undefined;
    mocks.executeMultiWithProgress.mockImplementation((_connId: string, _db: string, _sql: string, progress: (event: unknown) => void) => {
      onProgress = progress;
      return deferred.promise;
    });
    const { store, tabId } = await bootstrapStore();
    const execution = store.executeTabSql(tabId, "SELECT 1; SELECT broken");

    await vi.waitFor(() => expect(onProgress).toBeDefined());
    const tab = store.tabs.find((item) => item.id === tabId)!;
    const executionId = tab.executionId!;

    onProgress!({ executionId, statementIndex: 0, completed: 1, total: 2, success: false, executionTimeMs: 3, affectedRows: 0, error: { message: "boom" } });
    expect(tab.uiState?.activeOutputView).toBe("summary");
    expect(tab.batchSqlExecution?.errorAutoSwitchedToSummary).toBe(true);

    // A second failing statement in the same run must not re-switch anything.
    onProgress!({ executionId, statementIndex: 1, completed: 2, total: 2, success: false, executionTimeMs: 2, affectedRows: 0, error: { message: "boom again" } });
    expect(tab.uiState?.activeOutputView).toBe("summary");

    deferred.resolve([errorResult(0), errorResult(1)]);
    await execution;
    expect(tab.isExecuting).toBe(false);
  });

  it("never overrides a view the user redirected mid-run; the pin survives the run settle", async () => {
    const deferred = deferredExecution();
    let onProgress: ((progress: unknown) => void) | undefined;
    mocks.executeMultiWithProgress.mockImplementation((_connId: string, _db: string, _sql: string, progress: (event: unknown) => void) => {
      onProgress = progress;
      return deferred.promise;
    });
    const { store, tabId } = await bootstrapStore();
    const execution = store.executeTabSql(tabId, "SELECT 1; SELECT broken");

    await vi.waitFor(() => expect(onProgress).toBeDefined());
    const tab = store.tabs.find((item) => item.id === tabId)!;

    // The user redirects the view while the batch is still running...
    store.updateTabUiState(tabId, { activeOutputView: "chart" });
    expect(tab.userPinnedOutputViewDuringExecution).toBe(true);

    // ...so the mid-batch error switch stays silent.
    onProgress!({ executionId: tab.executionId!, statementIndex: 0, completed: 1, total: 2, success: false, executionTimeMs: 3, affectedRows: 0, error: { message: "boom" } });
    expect(tab.uiState?.activeOutputView).toBe("chart");
    expect(tab.batchSqlExecution?.errorAutoSwitchedToSummary).toBeUndefined();

    // Error run without streamed notices: settle deletes streamingNotices, but
    // the tab-level pin survives so the completion switch can still respect it.
    deferred.resolve([successSelect(0), errorResult(1)]);
    await execution;
    expect(tab.streamingNotices).toBeUndefined();
    expect(tab.userPinnedOutputViewDuringExecution).toBe(true);
  });

  it("does not switch for cancellations, detected via isCancelling or the cancel error code", async () => {
    const deferred = deferredExecution();
    let onProgress: ((progress: unknown) => void) | undefined;
    mocks.executeMultiWithProgress.mockImplementation((_connId: string, _db: string, _sql: string, progress: (event: unknown) => void) => {
      onProgress = progress;
      return deferred.promise;
    });
    const { store, tabId } = await bootstrapStore();
    const execution = store.executeTabSql(tabId, "SELECT 1; SELECT pg_sleep(60)");

    await vi.waitFor(() => expect(onProgress).toBeDefined());
    const tab = store.tabs.find((item) => item.id === tabId)!;
    const executionId = tab.executionId!;

    // A stop in flight suppresses the switch.
    tab.isCancelling = true;
    onProgress!({ executionId, statementIndex: 0, completed: 1, total: 2, success: false, executionTimeMs: 3, affectedRows: 0, error: { message: "boom" } });
    expect(tab.uiState?.activeOutputView).not.toBe("summary");
    tab.isCancelling = false;

    // So does an error that is really the backend's cancellation report.
    onProgress!({ executionId, statementIndex: 1, completed: 2, total: 2, success: false, executionTimeMs: 2, affectedRows: 0, error: { code: "DBX-JDBC-2003", message: "statement cancelled" } });
    expect(tab.uiState?.activeOutputView).not.toBe("summary");
    expect(tab.batchSqlExecution?.errorAutoSwitchedToSummary).toBeUndefined();

    deferred.resolve([errorResult(0), errorResult(1)]);
    await execution;
  });

  it("leaves single-statement runs to the completion switch (no mid-batch flip)", async () => {
    mocks.executeMulti.mockRejectedValue(new Error("boom"));
    const { store, tabId } = await bootstrapStore();
    await store.executeTabSql(tabId, "SELECT broken");

    const tab = store.tabs.find((item) => item.id === tabId)!;
    expect(tab.batchSqlExecution?.total).toBe(1);
    expect(tab.batchSqlExecution?.errorAutoSwitchedToSummary).toBeUndefined();
    expect(tab.uiState?.activeOutputView).not.toBe("summary");
  });

  it("flags background-run errors, honours cancellations, and acknowledges on activation", async () => {
    const { store, tabId } = await bootstrapStore();
    const foregroundTabId = store.createTab("pg-1", "app", "Foreground", "query", "public");
    store.activateTab(foregroundTabId);

    // Error finishing on an inactive tab raises the unacknowledged flag.
    let deferred = deferredExecution();
    mocks.executeMulti.mockImplementation(() => deferred.promise);
    let execution = store.executeTabSql(tabId, "SELECT broken");
    await vi.waitFor(() => expect(mocks.executeMulti).toHaveBeenCalledOnce());
    deferred.resolve([errorResult(0)]);
    await execution;
    let tab = store.tabs.find((item) => item.id === tabId)!;
    expect(tab.lastRunErrorUnacknowledged).toBe(true);
    expect(tab.lastRunCancelled).toBe(false);

    // Activating the tab acknowledges the dot.
    store.activateTab(tabId);
    expect(tab.lastRunErrorUnacknowledged).toBe(false);

    // A run the user cancelled is not an error: no dot, lastRunCancelled set.
    store.activateTab(foregroundTabId);
    deferred = deferredExecution();
    mocks.executeMulti.mockImplementation(() => deferred.promise);
    execution = store.executeTabSql(tabId, "SELECT pg_sleep(60)");
    await vi.waitFor(() => expect(mocks.executeMulti).toHaveBeenCalledTimes(2));
    tab = store.tabs.find((item) => item.id === tabId)!;
    tab.cancelRequestCount = (tab.cancelRequestCount ?? 0) + 1;
    deferred.resolve([errorResult(0)]);
    await execution;
    expect(tab.lastRunCancelled).toBe(true);
    expect(tab.lastRunErrorUnacknowledged).toBe(false);

    // The next run start clears the error-surfacing state for a fresh run.
    deferred = deferredExecution();
    mocks.executeMulti.mockImplementation(() => deferred.promise);
    const nextExecution = store.executeTabSql(tabId, "SELECT 1");
    await vi.waitFor(() => expect(mocks.executeMulti).toHaveBeenCalledTimes(3));
    tab = store.tabs.find((item) => item.id === tabId)!;
    expect(tab.lastRunCancelled).toBe(false);
    expect(tab.lastRunErrorUnacknowledged).toBe(false);
    expect(tab.userPinnedOutputViewDuringExecution).toBe(false);
    deferred.resolve([successSelect(0)]);
    await nextExecution;
  });

  it("does not flag the active tab's own errors", async () => {
    const deferred = deferredExecution();
    mocks.executeMulti.mockImplementation(() => deferred.promise);
    const { store, tabId } = await bootstrapStore();
    const execution = store.executeTabSql(tabId, "SELECT broken");
    await vi.waitFor(() => expect(mocks.executeMulti).toHaveBeenCalledOnce());
    deferred.resolve([errorResult(0)]);
    await execution;
    const tab = store.tabs.find((item) => item.id === tabId)!;
    expect(tab.lastRunErrorUnacknowledged).toBe(false);
  });
});
