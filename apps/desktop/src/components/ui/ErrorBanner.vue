<script setup lang="ts">
import { computed } from "vue";
import { Copy, TriangleAlert, X } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/common/clipboard";
import { useToast } from "@/composables/useToast";

const { t } = useI18n();
const { toast } = useToast();

const props = withDefaults(
  defineProps<{
    message: string;
    variant?: "banner" | "centered" | "card";
    /** Card-only: swap the destructive palette for an amber warning (nothing written, not a failure). */
    tone?: "error" | "warning";
    title?: string;
    dismissible?: boolean;
    copyMode?: "icon" | "label";
  }>(),
  {
    variant: "banner",
    tone: "error",
    dismissible: false,
    copyMode: "icon",
  },
);

const emit = defineEmits<{
  dismiss: [];
}>();

const displayTitle = computed(() => props.title ?? t("grid.queryError"));

// Warning tone (card variant only): the house amber palette instead of
// destructive — the save did not fail, but nothing was written.
const isWarning = computed(() => props.tone === "warning");
const cardShellClass = computed(() => (isWarning.value ? "border-amber-500/30 bg-amber-500/10" : "border-destructive/30 bg-destructive/10"));
const cardTitleClass = computed(() => (isWarning.value ? "text-amber-700 dark:text-amber-300" : "text-destructive"));
const cardBodyClass = computed(() => (isWarning.value ? "text-amber-800 dark:text-amber-200" : "text-destructive"));
const cardCopyClass = computed(() => (isWarning.value ? "text-amber-700/80 hover:text-amber-700 dark:text-amber-300/80 dark:hover:text-amber-300 hover:bg-amber-500/15" : "text-destructive/80 hover:text-destructive hover:bg-destructive/15"));
const cardDismissClass = computed(() => (isWarning.value ? "text-amber-700/70 hover:text-amber-700 dark:text-amber-300/70 dark:hover:text-amber-300 hover:bg-amber-500/15" : "text-destructive/70 hover:text-destructive hover:bg-destructive/15"));

// Centered variant: the first physical line is the actual error (red
// headline); everything after it — DETAIL, SQL statement, PL/pgSQL trace,
// HINT, SQLSTATE, server messages — renders as a readable monospace report.
const newlineIndex = computed(() => props.message.indexOf("\n"));
const headline = computed(() => (newlineIndex.value === -1 ? props.message : props.message.slice(0, newlineIndex.value)));
const reportBody = computed(() => (newlineIndex.value === -1 ? "" : props.message.slice(newlineIndex.value + 1)));

async function copy() {
  try {
    await copyToClipboard(props.message);
    toast(t("grid.copied"));
  } catch (e: any) {
    toast(t("grid.copyFailed", { message: e?.message || String(e) }), 5000);
  }
}
</script>

<template>
  <!-- card: 卡片类报错信息面板（单层框架：标题行 + 正文，正文不再嵌套内框） -->
  <div v-if="variant === 'card'" class="mx-3 my-2 rounded-lg border px-3 py-2 shrink-0 select-text flex flex-col gap-1.5" :class="cardShellClass">
    <div class="flex items-center justify-between gap-2">
      <div data-native-clipboard class="flex items-center gap-1.5 font-medium text-xs" :class="cardTitleClass">
        <TriangleAlert class="h-3.5 w-3.5 shrink-0" :class="cardTitleClass" aria-hidden="true" />
        <span>{{ displayTitle }}</span>
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        <Button variant="ghost" size="sm" class="h-6 gap-1 px-1.5 text-[11px]" :class="cardCopyClass" :aria-label="t('grid.copy')" @click.stop="copy">
          <Copy class="h-3 w-3" />
          {{ t("grid.copy") }}
        </Button>
        <Button v-if="dismissible" variant="ghost" size="icon-sm" class="h-6 w-6" :class="cardDismissClass" :aria-label="t('grid.dismiss')" @click.stop="emit('dismiss')">
          <X class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
    <div data-native-clipboard class="max-h-40 overflow-y-auto text-xs font-mono leading-relaxed break-words whitespace-pre-wrap select-text cursor-text" :class="cardBodyClass" @mousedown.stop @click.stop>
      {{ message }}
    </div>
  </div>

  <!-- banner: 紧凑内联横幅 -->
  <div v-else-if="variant === 'banner'" class="flex items-center gap-2 px-3 py-1.5 border-t bg-destructive/10 text-destructive text-xs shrink-0">
    <span data-native-clipboard class="flex-1 min-w-0 break-all">{{ message }}</span>
    <button v-if="copyMode === 'label'" type="button" class="shrink-0 hover:underline" :aria-label="t('grid.copy')" @click.stop="copy">
      {{ t("grid.copy") }}
    </button>
    <Button v-else variant="ghost" size="icon-sm" class="h-5 w-5 shrink-0 text-destructive/70 hover:text-destructive" :aria-label="t('grid.copy')" @click.stop="copy">
      <Copy class="h-3 w-3" />
    </Button>
    <button v-if="dismissible" type="button" class="shrink-0 hover:underline" @click.stop="emit('dismiss')">{{ t("grid.dismiss") }}</button>
  </div>

  <!-- centered: 居中占满。首行错误红色突出，其余报告进等宽面板（可读、可选择、可滚动） -->
  <div v-else class="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-6 py-4">
    <TriangleAlert class="h-8 w-8 shrink-0 text-destructive/50" aria-hidden="true" />
    <!--
      The detail panel is now the only scroll surface: the outer wrapper keeps
      flex-1 min-h-0 with no overflow of its own, and the panel's flex-1
      min-h-0 + overflow-y-auto bounds it to the pane height without a fixed
      max-height cap — a fixed rem cap clips long error text with an
      unreachable scrollbar instead (issue #7960). min-w-0 keeps long unspaced
      backend tokens wrapping instead of widening this centered child. Do not
      remove either.
    -->
    <div class="min-h-0 min-w-0 w-full max-w-3xl flex flex-col gap-2">
      <div data-native-clipboard class="text-left text-sm font-medium text-destructive whitespace-pre-wrap break-words select-text">{{ headline }}</div>
      <div
        v-if="reportBody"
        data-native-clipboard
        class="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-left font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words select-text cursor-text"
        @mousedown.stop
        @click.stop
      >
        {{ reportBody }}
      </div>
    </div>
    <div class="shrink-0 flex flex-wrap items-center justify-center gap-2 text-foreground">
      <Button variant="outline" size="sm" class="h-7 gap-1.5 px-2 text-xs" @click.stop="copy">
        <Copy class="h-3.5 w-3.5" />
        {{ t("grid.copy") }}
      </Button>
      <slot name="actions" />
    </div>
  </div>
</template>
