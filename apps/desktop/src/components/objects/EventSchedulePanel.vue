<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { CalendarClock, Loader2, PencilLine } from "@lucide/vue";
import { useToast } from "@/composables/useToast";
import { useConnectionStore } from "@/stores/connectionStore";
import * as api from "@/lib/backend/api";
import { executeWithProductionSqlGuard } from "@/lib/database/productionExecutionGuard";
import { SA_SCHEDULE_DAYS_OF_WEEK, buildAlterEventScheduleSql, scheduleDraftFromInfo, type SaEventScheduleDraft } from "@/lib/table/saEventSchedule";
import type { EventScheduleInfo } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// SQL Anywhere event schedules: the catalog stores them normalized in
// SYS.SYSSCHEDULE (SYSEVENT.source holds only the handler body), so each
// schedule is shown from catalog values and saved as a single
// ALTER EVENT ... ALTER SCHEDULE statement.

const props = defineProps<{
  connectionId: string;
  database: string;
  schema?: string | null;
  eventName: string;
  schedules: EventScheduleInfo[];
  disabled?: boolean;
}>();

const emit = defineEmits<{ saved: [] }>();

const { t } = useI18n();
const { toast } = useToast();
const connectionStore = useConnectionStore();

const editingIndex = ref<number | null>(null);
const draft = ref<SaEventScheduleDraft | null>(null);
const saving = ref(false);
const error = ref("");

function dayLabel(key: string): string {
  return t(`objects.eventSchedule.days.${key}`);
}

function scheduleDaysOfWeek(schedule: EventScheduleInfo): string[] {
  const mask = schedule.days_of_week ?? 0;
  return SA_SCHEDULE_DAYS_OF_WEEK.filter((day) => mask & day.bit).map((day) => dayLabel(day.key));
}

function editSchedule(index: number) {
  if (props.disabled || saving.value) return;
  editingIndex.value = index;
  draft.value = scheduleDraftFromInfo(props.schedules[index]);
  error.value = "";
}

function cancelEdit() {
  editingIndex.value = null;
  draft.value = null;
  error.value = "";
}

function toggleDay(bit: number) {
  if (!draft.value) return;
  draft.value = { ...draft.value, daysOfWeek: draft.value.daysOfWeek ^ bit };
}

function errorText(code: string): string {
  switch (code) {
    case "start-time-required":
      return t("objects.eventSchedule.startTimeRequired");
    case "every-invalid":
      return t("objects.eventSchedule.everyInvalid");
    case "days-of-month-invalid":
      return t("objects.eventSchedule.daysOfMonthInvalid");
    default:
      return t("objects.eventSchedule.dayMasksExclusive");
  }
}

async function saveSchedule() {
  const current = draft.value;
  if (!current || saving.value) return;
  const built = buildAlterEventScheduleSql({ schema: props.schema, name: props.eventName }, current);
  if ("error" in built) {
    error.value = errorText(built.error);
    return;
  }
  error.value = "";
  saving.value = true;
  try {
    const executed = await executeWithProductionSqlGuard({
      connection: connectionStore.getConfig(props.connectionId),
      database: props.database,
      sql: built.sql,
      source: t("production.sourceObjectSource"),
      execute: () => api.executeQuery(props.connectionId, props.database, built.sql),
    });
    if (!executed) return;
    toast(t("objects.eventSchedule.saved"));
    emit("saved");
    cancelEdit();
  } catch (e: any) {
    error.value = t("objects.eventSchedule.saveFailed", { message: e?.message || String(e) });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="shrink-0 rounded border bg-background text-sm" data-event-schedule>
    <div class="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground">
      <CalendarClock class="h-3.5 w-3.5" />
      {{ t("objects.eventSchedule.title") }}
    </div>

    <p v-if="!schedules.length" class="px-3 py-2 text-xs text-muted-foreground">
      {{ t("objects.eventSchedule.noSchedules") }}
    </p>

    <div v-for="(schedule, index) in schedules" :key="(schedule.name || '') + ':' + index" class="border-b px-3 py-2 last:border-b-0">
      <template v-if="editingIndex !== index">
        <div class="flex items-start justify-between gap-3">
          <dl class="grid min-w-0 flex-1 grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-xs">
            <dt class="text-muted-foreground">{{ t("objects.eventSchedule.scheduleName") }}</dt>
            <dd class="truncate font-medium" :title="schedule.name ?? ''">{{ schedule.name || "—" }}</dd>
            <template v-if="schedule.start_time">
              <dt class="text-muted-foreground">{{ t("objects.eventSchedule.startTime") }}</dt>
              <dd class="font-mono">
                {{ schedule.start_time }}<template v-if="schedule.stop_time"> – {{ schedule.stop_time }}</template>
              </dd>
            </template>
            <template v-if="schedule.interval_amount">
              <dt class="text-muted-foreground">{{ t("objects.eventSchedule.everyLabel") }}</dt>
              <dd class="font-mono">{{ schedule.interval_amount }} {{ schedule.interval_units }}</dd>
            </template>
            <template v-if="scheduleDaysOfWeek(schedule).length">
              <dt class="text-muted-foreground">{{ t("objects.eventSchedule.onDaysOfWeek") }}</dt>
              <dd>{{ scheduleDaysOfWeek(schedule).join(", ") }}</dd>
            </template>
            <template v-if="schedule.start_date">
              <dt class="text-muted-foreground">{{ t("objects.eventSchedule.startDate") }}</dt>
              <dd class="font-mono">{{ schedule.start_date }}</dd>
            </template>
          </dl>
          <Button variant="ghost" size="sm" :disabled="disabled || saving" @click="editSchedule(index)">
            <PencilLine class="h-3.5 w-3.5" />
            {{ t("objects.eventSchedule.edit") }}
          </Button>
        </div>
      </template>

      <form v-else-if="draft" class="space-y-2" @submit.prevent="saveSchedule">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label class="space-y-1 text-xs">{{ t("objects.eventSchedule.scheduleName") }}<Input v-model="draft.name" :disabled="saving" data-schedule-name /></label>
          <label class="space-y-1 text-xs">{{ t("objects.eventSchedule.startTime") }}<Input v-model="draft.startTime" type="time" step="1" :disabled="saving" data-schedule-start-time /></label>
          <label class="space-y-1 text-xs">{{ t("objects.eventSchedule.stopTime") }}<Input v-model="draft.stopTime" type="time" step="1" :disabled="saving" data-schedule-stop-time /></label>
          <label class="space-y-1 text-xs"
            >{{ t("objects.eventSchedule.everyLabel") }}
            <span class="flex gap-2">
              <Input v-model="draft.everyAmount" type="number" min="1" inputmode="numeric" class="w-20" :disabled="saving" data-schedule-every-amount />
              <select v-model="draft.everyUnit" class="h-9 flex-1 rounded-md border bg-background px-2" :disabled="saving" data-schedule-every-unit>
                <option value="">—</option>
                <option value="HOURS">{{ t("objects.eventSchedule.hours") }}</option>
                <option value="MINUTES">{{ t("objects.eventSchedule.minutes") }}</option>
                <option value="SECONDS">{{ t("objects.eventSchedule.seconds") }}</option>
              </select>
            </span>
          </label>
          <label class="space-y-1 text-xs">{{ t("objects.eventSchedule.startDate") }}<Input v-model="draft.startDate" type="date" :disabled="saving" data-schedule-start-date /></label>
          <label class="space-y-1 text-xs"
            >{{ t("objects.eventSchedule.onDaysOfMonth") }}<Input v-model="draft.daysOfMonthText" placeholder="1,15,last" :disabled="saving" data-schedule-days-of-month />
            <span class="block text-[11px] font-normal text-muted-foreground">{{ t("objects.eventSchedule.daysOfMonthHint") }}</span>
          </label>
        </div>
        <div class="space-y-1 text-xs">
          <span class="text-muted-foreground">{{ t("objects.eventSchedule.onDaysOfWeek") }}</span>
          <div class="flex flex-wrap gap-x-3 gap-y-1">
            <label v-for="day in SA_SCHEDULE_DAYS_OF_WEEK" :key="day.key" class="flex items-center gap-1">
              <input type="checkbox" :checked="(draft.daysOfWeek & day.bit) !== 0" :disabled="saving" :data-schedule-day="day.key" @change="toggleDay(day.bit)" />
              {{ dayLabel(day.key) }}
            </label>
          </div>
        </div>
        <div v-if="error" class="text-xs text-destructive">{{ error }}</div>
        <div class="flex justify-end gap-2">
          <Button variant="outline" size="sm" :disabled="saving" @click="cancelEdit">{{ t("common.cancel") }}</Button>
          <Button size="sm" :disabled="saving" @click="saveSchedule">
            <Loader2 v-if="saving" class="h-3.5 w-3.5 animate-spin" />
            {{ t("common.save") }}
          </Button>
        </div>
      </form>
    </div>
  </div>
</template>
