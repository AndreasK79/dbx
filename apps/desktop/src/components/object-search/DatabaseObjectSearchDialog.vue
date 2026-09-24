<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Database, Search } from "@lucide/vue";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDatabaseObjectSearch, type DatabaseObjectSearchItem } from "@/composables/useDatabaseObjectSearch";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  select: [item: DatabaseObjectSearchItem, target?: "source" | "data"];
}>();

const { t } = useI18n();
const { searchQuery, filteredItems, selectedIndex, selectedItem, loading, errorMessage, scope, loadActiveDatabase, selectNext, selectPrevious } = useDatabaseObjectSearch();
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const dialogOpen = computed({
  get: () => props.open,
  set: (value) => emit("update:open", value),
});

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectNext();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectPrevious();
  } else if (e.key === "Enter") {
    const target = selectedItem.value;
    if (target) {
      e.preventDefault();
      handleSelect(target);
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    dialogOpen.value = false;
  }
}

function handleSelect(item: DatabaseObjectSearchItem, target: "source" | "data" = "source"): void {
  emit("select", item, target);
  dialogOpen.value = false;
}

// Only table-like objects have a data view; routines open source exclusively.
function hasDataView(item: DatabaseObjectSearchItem): boolean {
  return item.type === "table" || item.type === "view" || item.type === "materialized_view";
}

function getTypeLabel(type: DatabaseObjectSearchItem["type"]): string {
  switch (type) {
    case "table":
      return t("common.table");
    case "view":
      return t("common.view");
    case "materialized_view":
      return t("common.materializedView");
    case "procedure":
      return t("common.procedure");
    case "function":
      return t("common.function");
    case "trigger":
      return t("objectSearch.trigger");
  }
}

function getHighlightedLabel(item: any): (string | { text: string; highlight: boolean })[] {
  if (!searchQuery.value.trim() || !item.matchIndices) {
    return [item.label];
  }

  const indices = new Set(item.matchIndices);
  const parts: (string | { text: string; highlight: boolean })[] = [];
  let current = "";
  let isHighlighting = false;

  for (let i = 0; i < item.label.length; i++) {
    const char = item.label[i];
    const shouldHighlight = indices.has(i);

    if (shouldHighlight !== isHighlighting) {
      if (current) {
        parts.push({
          text: current,
          highlight: isHighlighting,
        });
      }
      current = char;
      isHighlighting = shouldHighlight;
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push({
      text: current,
      highlight: isHighlighting,
    });
  }

  return parts;
}

watch(
  () => props.open,
  (newOpen) => {
    if (newOpen) {
      void loadActiveDatabase();
      nextTick(() => {
        inputRef.value?.focus();
      });
    }
  },
  // The dialog stays mounted (closed) in the app shell; `immediate` covers a
  // first render that starts out open without firing a load when closed.
  { immediate: true },
);

// Keep the highlighted row in view when keyboard navigation moves the selection.
watch(selectedIndex, async () => {
  await nextTick();
  const container = listRef.value;
  if (!container) return;
  container.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({ block: "nearest" });
});
</script>

<template>
  <Dialog :open="dialogOpen" @update:open="dialogOpen = $event">
    <DialogContent class="max-w-2xl p-0 gap-0 rounded-lg overflow-hidden">
      <div class="flex flex-col bg-background">
        <!-- Search Input -->
        <div class="flex items-center gap-3 px-4 pr-12 py-3 border-b">
          <Search class="h-5 w-5 text-muted-foreground" />
          <Input
            ref="inputRef"
            v-model="searchQuery"
            type="text"
            :placeholder="scope ? t('objectSearch.placeholder', { database: scope.database }) : t('objectSearch.placeholderNoDatabase')"
            class="flex-1 border-0 bg-transparent p-0 placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:outline-none"
            data-object-search-input
            @keydown="handleKeyDown"
          />
          <span v-if="scope" class="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap shrink-0">
            <Database class="h-3.5 w-3.5" />
            {{ scope.database }}
          </span>
        </div>

        <!-- Results List -->
        <div ref="listRef" class="max-h-[400px] overflow-y-auto" data-object-search-list>
          <div v-if="!scope" class="px-4 py-8 text-center text-muted-foreground" data-object-search-empty>
            {{ t("objectSearch.noActiveDatabase") }}
          </div>
          <div v-else-if="loading" class="px-4 py-8 text-center text-muted-foreground" data-object-search-loading>
            {{ t("objectSearch.loading") }}
          </div>
          <div v-else-if="errorMessage" class="px-4 py-8 text-center text-muted-foreground" data-object-search-error>
            {{ t("objectSearch.loadError") }}
            <div class="mt-1 text-xs break-all">{{ errorMessage }}</div>
          </div>
          <div v-else-if="filteredItems.length === 0" class="px-4 py-8 text-center text-muted-foreground" data-object-search-empty>
            {{ t("objectSearch.noResults") }}
          </div>
          <div v-else class="divide-y">
            <div
              v-for="(item, index) in filteredItems"
              :key="item.id"
              :data-selected="index === selectedIndex"
              :data-object-type="item.type"
              :class="['px-4 py-2 cursor-pointer', index === selectedIndex ? 'bg-accent' : 'hover:bg-muted']"
              @click="handleSelect(item)"
              @mouseenter="selectedIndex = index"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium truncate">
                      <template v-for="(part, i) in getHighlightedLabel(item)" :key="i">
                        <span v-if="typeof part === 'object'" :class="{ 'bg-yellow-200 dark:bg-yellow-800 font-semibold': part.highlight }">
                          {{ part.text }}
                        </span>
                        <span v-else>{{ part }}</span>
                      </template>
                    </div>
                    <div v-if="item.schema" class="text-xs text-muted-foreground truncate">
                      {{ item.schema }}
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-1.5 whitespace-nowrap shrink-0">
                  <div class="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
                    {{ getTypeLabel(item.type) }}
                  </div>
                  <button type="button" class="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" data-object-search-source @click.stop="handleSelect(item, 'source')">
                    {{ t("objectSearch.openSource") }}
                  </button>
                  <button v-if="hasDataView(item)" type="button" class="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" data-object-search-view-data @click.stop="handleSelect(item, 'data')">
                    {{ t("objectSearch.openData") }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-4 py-2 border-t text-xs text-muted-foreground flex justify-between">
          <div>{{ filteredItems.length }} {{ t("objectSearch.results") }}</div>
          <div class="flex gap-4">
            <span><kbd class="px-2 py-1 rounded bg-muted">↑↓</kbd> {{ t("objectSearch.navigate") }}</span>
            <span><kbd class="px-2 py-1 rounded bg-muted">⏎</kbd> {{ t("objectSearch.openSource") }}</span>
            <span><kbd class="px-2 py-1 rounded bg-muted">ESC</kbd> {{ t("objectSearch.close") }}</span>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
:deep([data-slot="dialog-content"]) {
  border-color: color-mix(in srgb, var(--border) 80%, var(--ring));
  box-shadow: 0 24px 70px rgb(0 0 0 / 0.32);
}

:deep(.divide-y > div.bg-accent) {
  background-color: var(--info-bg) !important;
  box-shadow: inset 3px 0 0 var(--info) !important;
}

:deep(.bg-yellow-200),
:deep(.dark .bg-yellow-800) {
  background-color: var(--warning-bg) !important;
  border-radius: 0.1875rem;
  padding: 0 0.0625rem;
}
</style>
