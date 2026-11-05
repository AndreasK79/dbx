// @vitest-environment happy-dom
import { createApp, h, nextTick, reactive, type App } from "vue";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventSchedulePanel from "../EventSchedulePanel.vue";
import type { EventScheduleInfo } from "@/types/database";

const api = vi.hoisted(() => ({ executeQuery: vi.fn() }));
vi.mock("@/lib/backend/api", async (original) => ({ ...(await original<typeof import("@/lib/backend/api")>()), ...api }));

const messages = {
  common: { save: "Save", cancel: "Cancel" },
  objects: {
    eventSchedule: {
      title: "Schedules",
      noSchedules: "No schedule",
      scheduleName: "Schedule name",
      startTime: "Start time",
      stopTime: "End time",
      startDate: "Start date",
      everyLabel: "Every",
      hours: "hours",
      minutes: "minutes",
      seconds: "seconds",
      onDaysOfWeek: "On days of week",
      onDaysOfMonth: "On days of month",
      daysOfMonthHint: "1-31 or last",
      edit: "Edit",
      saved: "Schedule saved",
      saveFailed: "Failed: {message}",
      startTimeRequired: "Start time is required.",
      everyInvalid: "Every needs a number and unit.",
      daysOfMonthInvalid: "Bad days.",
      dayMasksExclusive: "Pick one day mask.",
      days: { sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat" },
    },
  },
};

const mounted: Array<{ app: App; host: HTMLElement }> = [];
afterEach(() => {
  for (const { app, host } of mounted.splice(0)) {
    app.unmount();
    host.remove();
  }
  vi.clearAllMocks();
});

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label)!;
}

async function mountPanel(schedules: EventScheduleInfo[]) {
  let saved = false;
  const props = reactive({ connectionId: "conn-a", database: "db", schema: "DBA", eventName: "BackupDB", schedules, disabled: false, onSaved: () => (saved = true) });
  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp({ render: () => h(EventSchedulePanel, props) });
  app.use(createPinia());
  app.use(createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false, messages: { en: messages } }));
  app.mount(host);
  mounted.push({ app, host });
  await nextTick();
  return { saved: () => saved };
}

describe("EventSchedulePanel", () => {
  it("shows catalog schedule values per row", async () => {
    await mountPanel([{ name: "BackupDB", recurring: true, start_time: "23:00:00", start_date: "2001-01-01", days_of_week: 127 }]);
    expect(document.querySelector("[data-event-schedule]")?.textContent).toContain("BackupDB");
    expect(document.querySelector("[data-event-schedule]")?.textContent).toContain("23:00:00");
    expect(document.querySelector("[data-event-schedule]")?.textContent).toContain("Sun");
    expect(document.querySelector("[data-event-schedule]")?.textContent).toContain("Sat");
    expect(api.executeQuery).not.toHaveBeenCalled();
  });

  it("edits a schedule and saves it as one ALTER EVENT ... ALTER SCHEDULE statement", async () => {
    api.executeQuery.mockResolvedValue({});
    const panel = await mountPanel([{ name: "BackupDB", recurring: true, start_time: "23:00:00" }]);
    button("Edit").click();
    await nextTick();
    const startTime = document.querySelector<HTMLInputElement>("[data-schedule-start-time]")!;
    startTime.value = "23:30:00";
    startTime.dispatchEvent(new Event("input"));
    await nextTick();
    button("Save").click();
    await vi.waitFor(() => expect(panel.saved()).toBe(true));
    expect(api.executeQuery).toHaveBeenCalledTimes(1);
    expect(api.executeQuery).toHaveBeenCalledWith("conn-a", "db", 'ALTER EVENT "DBA"."BackupDB" ALTER SCHEDULE "BackupDB" START TIME \'23:30\';');
  });

  it("blocks saving without a start time and surfaces the reason", async () => {
    const panel = await mountPanel([{ name: "", recurring: true, start_time: "23:00:00" }]);
    button("Edit").click();
    await nextTick();
    const startTime = document.querySelector<HTMLInputElement>("[data-schedule-start-time]")!;
    startTime.value = "";
    startTime.dispatchEvent(new Event("input"));
    await nextTick();
    button("Save").click();
    await nextTick();
    expect(document.querySelector("[data-event-schedule]")?.textContent).toContain("Start time is required.");
    expect(api.executeQuery).not.toHaveBeenCalled();
    expect(panel.saved()).toBe(false);
  });
});
