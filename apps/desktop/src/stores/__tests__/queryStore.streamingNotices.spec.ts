import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // withStatementNotices captures the per-run stream callback so tests can
  // replay query-statement-notices events against the live tab.
  const capturedStreams: Array<{ executionId: string; onStatementNotices: (event: unknown) => void }> = [];
  return {
    capturedStreams,
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
  };
});

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

function notice(text: string) {
  return { severity: "NOTICE", message: text };
}

function successSelect(statementIndex: number) {
  return { columns: ["VALUE"], rows: [[1]], affected_rows: 0, execution_time_ms: 1, statement_index: statementIndex };
}

function errorResult(statementIndex: number) {
  return { columns: ["Error"], rows: [["ERROR: boom"]], affected_rows: 0, execution_time_ms: 1, execution_error: true, statement_index: statementIndex };
}

/** Blocks the backend call until the test releases it, so mid-run streaming state is observable. */
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

describe("queryStore streaming statement notices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    installLocalStorage();
    setActivePinia(createPinia());
    mocks.capturedStreams.length = 0;
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
    mocks.withStatementNotices.mockImplementation(async (executionId: string, onStatementNotices: (event: unknown) => void, run: () => Promise<unknown>) => {
      mocks.capturedStreams.push({ executionId, onStatementNotices });
      return run();
    });
  });

  it("creates the stream eagerly, appends events in order, drops stale runs, and clears the stream after an all-success run", async () => {
    const deferred = deferredExecution();
    // Multi-statement SQL dispatches through the batch executor; the stream
    // subscription wraps it exactly like the single-statement path.
    mocks.executeMultiWithProgress.mockImplementation(() => deferred.promise);
    const { store, tabId } = await bootstrapStore();
    const execution = store.executeTabSql(tabId, "DO $$ BEGIN RAISE NOTICE 'step'; END $$; SELECT 1");

    await vi.waitFor(() => expect(mocks.executeMultiWithProgress).toHaveBeenCalledOnce());
    const tab = store.tabs.find((item) => item.id === tabId)!;
    const stream = mocks.capturedStreams.at(-1)!;
    expect(tab.isExecuting).toBe(true);
    expect(tab.streamingNotices).toEqual({ executionId: stream.executionId, items: [] });

    stream.onStatementNotices({ executionId: stream.executionId, statementIndex: 0, notices: [notice("step 1"), notice("step 2")] });
    stream.onStatementNotices({ executionId: "stale-run", statementIndex: 0, notices: [notice("stale")] });
    stream.onStatementNotices({ executionId: stream.executionId, statementIndex: 1, notices: [notice("later")] });

    expect(tab.streamingNotices?.items.map((item) => item.message.message)).toEqual(["step 1", "step 2", "later"]);
    expect(tab.streamingNotices?.items.map((item) => item.statementIndex)).toEqual([0, 0, 1]);

    deferred.resolve([successSelect(0), successSelect(1)]);
    await execution;

    expect(tab.isExecuting).toBe(false);
    // Success statements already carry their notices in result.messages; the
    // streamed copies must not double-render at rest.
    expect(tab.streamingNotices).toBeUndefined();
  });

  it("auto-switches the output view to messages on the first notice and never again after the user redirects", async () => {
    const deferred = deferredExecution();
    mocks.executeMulti.mockImplementation(() => deferred.promise);
    const { store, tabId } = await bootstrapStore();
    const execution = store.executeTabSql(tabId, "DO $$ BEGIN RAISE NOTICE 'one'; END $$");

    await vi.waitFor(() => expect(mocks.executeMulti).toHaveBeenCalledOnce());
    const tab = store.tabs.find((item) => item.id === tabId)!;
    const stream = mocks.capturedStreams.at(-1)!;

    expect(tab.uiState?.activeOutputView).not.toBe("messages");
    stream.onStatementNotices({ executionId: stream.executionId, statementIndex: 0, notices: [notice("one")] });
    expect(tab.uiState?.activeOutputView).toBe("messages");
    expect(tab.streamingNotices?.autoSwitchedToMessages).toBe(true);

    // A user-driven view change mid-run pins the view...
    store.updateTabUiState(tabId, { activeOutputView: "result" });
    expect(tab.streamingNotices?.userPinnedOutputView).toBe(true);
    // ...so later notices never yank it back to messages.
    stream.onStatementNotices({ executionId: stream.executionId, statementIndex: 0, notices: [notice("two")] });
    expect(tab.uiState?.activeOutputView).toBe("result");

    deferred.resolve([successSelect(0)]);
    await execution;
  });

  it("keeps the user's chosen view when they redirect before any notice arrives", async () => {
    const deferred = deferredExecution();
    mocks.executeMulti.mockImplementation(() => deferred.promise);
    const { store, tabId } = await bootstrapStore();
    const execution = store.executeTabSql(tabId, "DO $$ BEGIN RAISE NOTICE 'one'; END $$");

    await vi.waitFor(() => expect(mocks.executeMulti).toHaveBeenCalledOnce());
    const tab = store.tabs.find((item) => item.id === tabId)!;
    const stream = mocks.capturedStreams.at(-1)!;

    store.updateTabUiState(tabId, { activeOutputView: "chart" });
    stream.onStatementNotices({ executionId: stream.executionId, statementIndex: 0, notices: [notice("one")] });

    expect(tab.streamingNotices?.items.length).toBe(1);
    expect(tab.streamingNotices?.userPinnedOutputView).toBe(true);
    expect(tab.streamingNotices?.autoSwitchedToMessages).not.toBe(true);
    expect(tab.uiState?.activeOutputView).toBe("chart");

    deferred.resolve([successSelect(0)]);
    await execution;
  });

  it("settles an error run by keeping only the failed statement's notices, without pinning post-completion view changes", async () => {
    const deferred = deferredExecution();
    mocks.executeMultiWithProgress.mockImplementation(() => deferred.promise);
    const { store, tabId } = await bootstrapStore();
    const execution = store.executeTabSql(tabId, "DO $$ BEGIN RAISE NOTICE 'before failure'; END $$; SELECT broken");

    await vi.waitFor(() => expect(mocks.executeMultiWithProgress).toHaveBeenCalledOnce());
    const tab = store.tabs.find((item) => item.id === tabId)!;
    const stream = mocks.capturedStreams.at(-1)!;

    stream.onStatementNotices({ executionId: stream.executionId, statementIndex: 0, notices: [notice("ok notice")] });
    stream.onStatementNotices({ executionId: stream.executionId, statementIndex: 1, notices: [notice("before failure")] });

    deferred.resolve([successSelect(0), errorResult(1)]);
    await execution;

    // The failed statement's notices only live inside the error string, so
    // their streamed copies stay visible in the Messages view.
    expect(tab.streamingNotices?.items.map((item) => item.message.message)).toEqual(["before failure"]);
    expect(tab.isExecuting).toBe(false);

    // Post-completion view changes no longer count as pinning the stream.
    store.updateTabUiState(tabId, { activeOutputView: "result" });
    expect(tab.streamingNotices?.userPinnedOutputView).toBeUndefined();
  });

  it("streams manual-transaction runs and forwards the execution id to the backend", async () => {
    mocks.beginManualTransaction.mockResolvedValue("txn-1");
    const deferred = deferredExecution();
    mocks.executeInManualTransaction.mockImplementation(() => deferred.promise);
    const { store, tabId } = await bootstrapStore();
    store.setAutoCommit(tabId, false);
    const execution = store.executeTabSql(tabId, "UPDATE users SET active = 1");

    await vi.waitFor(() => expect(mocks.executeInManualTransaction).toHaveBeenCalledOnce());
    const tab = store.tabs.find((item) => item.id === tabId)!;
    const stream = mocks.capturedStreams.at(-1)!;

    expect(tab.streamingNotices?.executionId).toBe(stream.executionId);
    expect(mocks.executeInManualTransaction.mock.calls[0]?.at(-1)).toBe(stream.executionId);

    stream.onStatementNotices({ executionId: stream.executionId, statementIndex: 0, notices: [notice("txn notice")] });
    expect(tab.streamingNotices?.items.map((item) => item.message.message)).toEqual(["txn notice"]);
    expect(tab.uiState?.activeOutputView).toBe("messages");

    deferred.resolve([{ columns: [], rows: [], affected_rows: 1, execution_time_ms: 1 }]);
    await execution;

    expect(tab.streamingNotices).toBeUndefined();
  });
});
