import type { EventScheduleInfo } from "@/types/database";

// SQL Anywhere keeps event schedules normalized in SYS.SYSSCHEDULE —
// SYSEVENT.source holds only the handler body — so schedules are
// round-tripped structurally and rewritten as one
// `ALTER EVENT ... ALTER SCHEDULE` statement per schedule (only one schedule
// can be altered per statement, per the ALTER EVENT grammar).

/** SYS.SYSSCHEDULE days_of_week bit values (0x01 = Sunday … 0x40 = Saturday).
 * `sqlName` is the English day name the ON ( day-of-week, … ) clause takes. */
export const SA_SCHEDULE_DAYS_OF_WEEK: { readonly bit: number; readonly sqlName: string; readonly key: string }[] = [
  { bit: 0x01, sqlName: "Sunday", key: "sunday" },
  { bit: 0x02, sqlName: "Monday", key: "monday" },
  { bit: 0x04, sqlName: "Tuesday", key: "tuesday" },
  { bit: 0x08, sqlName: "Wednesday", key: "wednesday" },
  { bit: 0x10, sqlName: "Thursday", key: "thursday" },
  { bit: 0x20, sqlName: "Friday", key: "friday" },
  { bit: 0x40, sqlName: "Saturday", key: "saturday" },
];

/** The SYS.SYSSCHEDULE bit that marks "last day of the month". */
export const SA_SCHEDULE_LAST_DAY_OF_MONTH_BIT = 0x80000000;

/** Editable form state for one schedule. */
export interface SaEventScheduleDraft {
  /** Catalog schedule name; empty for an unnamed (single) schedule. */
  name: string;
  /** 'HH:MM' or 'HH:MM:SS'; required. */
  startTime: string;
  /** Optional end time — emits BETWEEN start AND stop instead of START TIME. */
  stopTime: string;
  /** Optional 'YYYY-MM-DD' first execution date. */
  startDate: string;
  /** Optional EVERY interval: amount text plus unit. */
  everyAmount: string;
  everyUnit: "" | "HOURS" | "MINUTES" | "SECONDS";
  /** days_of_week bit mask; 0 = no ON ( day-of-week … ) clause. */
  daysOfWeek: number;
  /** Comma-separated day-of-month numbers ("1,15") and/or "last". */
  daysOfMonthText: string;
}

function saIntervalUnit(units: string | null | undefined): "" | "HOURS" | "MINUTES" | "SECONDS" {
  switch ((units ?? "").trim().toUpperCase()) {
    case "HH":
    case "HOURS":
      return "HOURS";
    case "SS":
    case "SECONDS":
      return "SECONDS";
    case "NN":
    case "MI":
    case "MINUTES":
      return "MINUTES";
    default:
      return "";
  }
}

export function scheduleDraftFromInfo(schedule: EventScheduleInfo): SaEventScheduleDraft {
  const lastMonth = (schedule.days_of_month ?? 0) & SA_SCHEDULE_LAST_DAY_OF_MONTH_BIT ? "last" : "";
  const monthDays: string[] = [];
  for (let day = 1; day <= 31; day += 1) {
    if ((schedule.days_of_month ?? 0) & (1 << (day - 1))) monthDays.push(String(day));
  }
  if (lastMonth) monthDays.push(lastMonth);
  return {
    name: schedule.name ?? "",
    startTime: schedule.start_time ?? "",
    stopTime: schedule.stop_time ?? "",
    startDate: schedule.start_date ?? "",
    everyAmount: schedule.interval_amount != null ? String(schedule.interval_amount) : "",
    everyUnit: saIntervalUnit(schedule.interval_units),
    daysOfWeek: schedule.days_of_week ?? 0,
    daysOfMonthText: monthDays.join(","),
  };
}

/** Parses "1,15,last" into the SYS.SYSSCHEDULE days_of_month mask, or null
 * when any token is not a day 1–31 / "last". Empty text is the empty mask. */
export function parseSaDaysOfMonth(text: string): number | null {
  let mask = 0;
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    if (/^last$/i.test(token)) {
      mask |= SA_SCHEDULE_LAST_DAY_OF_MONTH_BIT;
    } else if (/^\d+$/.test(token)) {
      const day = Number(token);
      if (day < 1 || day > 31) return null;
      mask |= 1 << (day - 1);
    } else {
      return null;
    }
  }
  return mask;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.trim().replace(/'/g, "''")}'`;
}

export type SaScheduleBuildResult = { sql: string } | { error: "start-time-required" | "every-invalid" | "days-of-month-invalid" | "day-masks-exclusive" };

/** Builds the `ALTER EVENT … ALTER SCHEDULE …` statement for one draft. */
export function buildAlterEventScheduleSql(event: { schema?: string | null; name: string }, draft: SaEventScheduleDraft): SaScheduleBuildResult {
  const startTime = draft.startTime.trim();
  if (!startTime) return { error: "start-time-required" };
  const stopTime = draft.stopTime.trim();
  if (draft.everyUnit && !draft.everyAmount.trim()) return { error: "every-invalid" };
  if (draft.everyAmount.trim()) {
    if (!/^\d+$/.test(draft.everyAmount.trim()) || Number(draft.everyAmount.trim()) < 1) return { error: "every-invalid" };
    if (!draft.everyUnit) return { error: "every-invalid" };
  }
  const daysOfMonth = parseSaDaysOfMonth(draft.daysOfMonthText);
  if (daysOfMonth === null) return { error: "days-of-month-invalid" };
  // The ON clause takes either day names or day numbers, never both.
  if (draft.daysOfWeek !== 0 && daysOfMonth !== 0) return { error: "day-masks-exclusive" };

  const parts: string[] = [];
  const eventName = quoteIdentifier(event.name);
  const target = event.schema?.trim() ? `${quoteIdentifier(event.schema.trim())}.${eventName}` : eventName;
  parts.push(`ALTER EVENT ${target} ALTER SCHEDULE`);
  if (draft.name.trim()) parts.push(quoteIdentifier(draft.name.trim()));
  parts.push(stopTime ? `BETWEEN ${quoteLiteral(startTime)} AND ${quoteLiteral(stopTime)}` : `START TIME ${quoteLiteral(startTime)}`);
  if (draft.everyAmount.trim() && draft.everyUnit) parts.push(`EVERY ${Number(draft.everyAmount.trim())} ${draft.everyUnit}`);
  if (draft.daysOfWeek !== 0) {
    const days = SA_SCHEDULE_DAYS_OF_WEEK.filter((day) => draft.daysOfWeek & day.bit).map((day) => quoteLiteral(day.sqlName));
    parts.push(`ON ( ${days.join(", ")} )`);
  } else if (daysOfMonth !== 0) {
    const days: string[] = [];
    for (let day = 1; day <= 31; day += 1) {
      if (daysOfMonth & (1 << (day - 1))) days.push(String(day));
    }
    if (daysOfMonth & SA_SCHEDULE_LAST_DAY_OF_MONTH_BIT) days.push("LAST");
    parts.push(`ON ( ${days.join(", ")} )`);
  }
  if (draft.startDate.trim()) parts.push(`START DATE ${quoteLiteral(draft.startDate)}`);
  return { sql: `${parts.join(" ")};` };
}
