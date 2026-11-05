import { describe, expect, it } from "vitest";
import { buildAlterEventScheduleSql, parseSaDaysOfMonth, scheduleDraftFromInfo } from "@/lib/table/saEventSchedule";

describe("scheduleDraftFromInfo", () => {
  it("maps a SYS.SYSSCHEDULE row into draft fields", () => {
    const draft = scheduleDraftFromInfo({
      name: "BackupDB",
      recurring: true,
      start_date: "2001-01-01",
      start_time: "23:00:00",
      days_of_week: 127,
      interval_units: null,
      interval_amount: null,
    });
    expect(draft.name).toBe("BackupDB");
    expect(draft.startTime).toBe("23:00:00");
    expect(draft.stopTime).toBe("");
    expect(draft.startDate).toBe("2001-01-01");
    expect(draft.everyAmount).toBe("");
    expect(draft.everyUnit).toBe("");
    expect(draft.daysOfWeek).toBe(127);
    expect(draft.daysOfMonthText).toBe("");
  });

  it("expands SA interval units and month-day masks including the last-day bit", () => {
    const draft = scheduleDraftFromInfo({
      start_time: "9:00",
      stop_time: "17:00",
      days_of_month: 0x80000000 | (1 << 0) | (1 << 14),
      interval_units: "NN",
      interval_amount: 30,
    });
    expect(draft.everyUnit).toBe("MINUTES");
    expect(draft.everyAmount).toBe("30");
    expect(draft.daysOfMonthText).toBe("1,15,last");
  });
});

describe("parseSaDaysOfMonth", () => {
  it("accepts day numbers and last in any order", () => {
    expect(parseSaDaysOfMonth("1, 15,last")).toBe(0x80000000 | 0x1 | 0x4000);
    expect(parseSaDaysOfMonth("")).toBe(0);
  });

  it("rejects out-of-range or non-numeric tokens", () => {
    expect(parseSaDaysOfMonth("0")).toBeNull();
    expect(parseSaDaysOfMonth("32")).toBeNull();
    expect(parseSaDaysOfMonth("monday")).toBeNull();
  });
});

describe("buildAlterEventScheduleSql", () => {
  it("rewrites a named daily schedule as ALTER EVENT ... ALTER SCHEDULE", () => {
    const built = buildAlterEventScheduleSql({ schema: "DBA", name: "BackupDB" }, { name: "BackupDB", startTime: "23:00", stopTime: "", startDate: "", everyAmount: "", everyUnit: "", daysOfWeek: 0, daysOfMonthText: "" });
    expect(built).toEqual({ sql: 'ALTER EVENT "DBA"."BackupDB" ALTER SCHEDULE "BackupDB" START TIME \'23:00\';' });
  });

  it("emits BETWEEN, EVERY, day names and START DATE when present", () => {
    const built = buildAlterEventScheduleSql({ schema: null, name: "purge" }, { name: "", startTime: "09:00", stopTime: "17:00", startDate: "2026-01-05", everyAmount: "30", everyUnit: "MINUTES", daysOfWeek: 0x02 | 0x08, daysOfMonthText: "" });
    expect(built).toEqual({
      sql: "ALTER EVENT \"purge\" ALTER SCHEDULE BETWEEN '09:00' AND '17:00' EVERY 30 MINUTES ON ( 'Monday', 'Wednesday' ) START DATE '2026-01-05';",
    });
  });

  it("emits month-day numbers with LAST for the last-day bit", () => {
    const built = buildAlterEventScheduleSql({ schema: "DBA", name: "monthend" }, { name: "", startTime: "1:00", stopTime: "", startDate: "", everyAmount: "", everyUnit: "", daysOfWeek: 0, daysOfMonthText: "15,last" });
    expect(built).toEqual({ sql: 'ALTER EVENT "DBA"."monthend" ALTER SCHEDULE START TIME \'1:00\' ON ( 15, LAST );' });
  });

  it("doubles quotes inside identifiers and literals", () => {
    const built = buildAlterEventScheduleSql({ schema: 'ow"ner', name: "Ni'ghtly" }, { name: 'Sc"h', startTime: "23:o'clock", stopTime: "", startDate: "", everyAmount: "", everyUnit: "", daysOfWeek: 0, daysOfMonthText: "" });
    expect(built).toEqual({
      sql: 'ALTER EVENT "ow""ner"."Ni\'ghtly" ALTER SCHEDULE "Sc""h" START TIME \'23:o\'\'clock\';',
    });
  });

  it("validates required and exclusive fields", () => {
    const base = { name: "", stopTime: "", startDate: "", daysOfWeek: 0, daysOfMonthText: "" } as const;
    expect(buildAlterEventScheduleSql({ name: "e" }, { ...base, startTime: "", everyAmount: "", everyUnit: "" })).toEqual({ error: "start-time-required" });
    expect(buildAlterEventScheduleSql({ name: "e" }, { ...base, startTime: "1:00", everyAmount: "0", everyUnit: "HOURS" })).toEqual({ error: "every-invalid" });
    expect(buildAlterEventScheduleSql({ name: "e" }, { ...base, startTime: "1:00", everyAmount: "5", everyUnit: "" })).toEqual({ error: "every-invalid" });
    expect(buildAlterEventScheduleSql({ name: "e" }, { ...base, startTime: "1:00", everyAmount: "", everyUnit: "HOURS" })).toEqual({ error: "every-invalid" });
    expect(buildAlterEventScheduleSql({ name: "e" }, { ...base, startTime: "1:00", everyAmount: "", everyUnit: "", daysOfMonthText: "32" })).toEqual({ error: "days-of-month-invalid" });
    expect(buildAlterEventScheduleSql({ name: "e" }, { ...base, startTime: "1:00", everyAmount: "", everyUnit: "", daysOfWeek: 0x02, daysOfMonthText: "1" })).toEqual({ error: "day-masks-exclusive" });
  });
});
