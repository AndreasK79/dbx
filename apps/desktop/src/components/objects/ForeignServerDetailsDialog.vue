<script setup lang="ts">
import { computed, ref } from "vue";
import { Server } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/useToast";
import { copyToClipboard } from "@/lib/common/clipboard";
import { createForeignServerSql } from "@/lib/database/postgresForeignServers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ForeignServerInfo, TreeNode } from "@/types/database";

const { t } = useI18n();
const { toast } = useToast();

const props = defineProps<{
  node: TreeNode;
}>();

const open = ref(false);
const server = computed<ForeignServerInfo>(() => {
  const meta = props.node.meta as ForeignServerInfo | undefined;
  return {
    name: meta?.name || props.node.label,
    wrapper: meta?.wrapper || "-",
    owner: meta?.owner || "",
    server_type: meta?.server_type || null,
    server_version: meta?.server_version || null,
    options: meta?.options || [],
    comment: meta?.comment || null,
    user_mappings: meta?.user_mappings || [],
    foreign_tables: meta?.foreign_tables || [],
  };
});
// Catalog srvoptions are always key=value, but a computed that throws would
// take the whole dialog down — degrade to a hint instead.
const createSql = computed(() => {
  try {
    return createForeignServerSql(server.value);
  } catch {
    return `-- ${t("foreignServer.ddlUnavailable")}`;
  }
});

function show() {
  open.value = true;
}

function copySql() {
  copyToClipboard(createSql.value);
  toast(t("foreignServer.sqlCopied"), 2000);
}

defineExpose({ show });
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="flex min-w-0 items-center gap-2 pr-8">
          <Server class="h-4 w-4 shrink-0 text-violet-500" />
          <span class="truncate">{{ t("foreignServer.detailsTitle") }}</span>
        </DialogTitle>
      </DialogHeader>

      <dl class="overflow-hidden rounded-md border text-sm">
        <div class="grid grid-cols-[7rem_minmax(0,1fr)] border-b px-3 py-2.5">
          <dt class="text-muted-foreground">{{ t("foreignServer.name") }}</dt>
          <dd class="min-w-0 break-words font-medium">{{ server.name }}</dd>
        </div>
        <div class="grid grid-cols-[7rem_minmax(0,1fr)] border-b px-3 py-2.5">
          <dt class="text-muted-foreground">{{ t("foreignServer.wrapper") }}</dt>
          <dd class="min-w-0 break-words font-mono">{{ server.wrapper }}</dd>
        </div>
        <div class="grid grid-cols-[7rem_minmax(0,1fr)] border-b px-3 py-2.5">
          <dt class="text-muted-foreground">{{ t("foreignServer.owner") }}</dt>
          <dd class="min-w-0 break-words">{{ server.owner || "-" }}</dd>
        </div>
        <div class="grid grid-cols-[7rem_minmax(0,1fr)] border-b px-3 py-2.5">
          <dt class="text-muted-foreground">{{ t("foreignServer.type") }}</dt>
          <dd class="min-w-0 break-words">{{ server.server_type || "-" }}</dd>
        </div>
        <div class="grid grid-cols-[7rem_minmax(0,1fr)] border-b px-3 py-2.5">
          <dt class="text-muted-foreground">{{ t("connection.version") }}</dt>
          <dd class="min-w-0 break-words">{{ server.server_version || "-" }}</dd>
        </div>
        <div class="grid grid-cols-[7rem_minmax(0,1fr)] border-b px-3 py-2.5">
          <dt class="text-muted-foreground">{{ t("foreignServer.options") }}</dt>
          <dd class="min-w-0 break-words font-mono">{{ server.options.length ? server.options.join(", ") : "-" }}</dd>
        </div>
        <div class="grid grid-cols-[7rem_minmax(0,1fr)] px-3 py-2.5">
          <dt class="text-muted-foreground">{{ t("structureEditor.comment") }}</dt>
          <dd class="min-w-0 whitespace-pre-wrap break-words">{{ server.comment || "-" }}</dd>
        </div>
      </dl>

      <div>
        <p class="mb-1.5 text-sm font-medium text-foreground">{{ t("foreignServer.userMappings") }}</p>
        <div class="max-h-40 overflow-auto rounded-md border">
          <table class="w-full text-sm text-left">
            <thead class="sticky top-0 bg-muted">
              <tr>
                <th class="p-2">{{ t("foreignServer.user") }}</th>
                <th class="p-2">{{ t("foreignServer.options") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="mapping in server.user_mappings" :key="mapping.username" class="border-t">
                <td class="p-2 break-all font-mono">{{ mapping.username }}</td>
                <td class="p-2 break-all font-mono">{{ mapping.options.join(", ") }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!server.user_mappings.length" class="p-3 text-sm text-muted-foreground">{{ t("foreignServer.noMappings") }}</p>
        </div>
      </div>

      <div>
        <p class="mb-1.5 text-sm font-medium text-foreground">{{ t("foreignServer.foreignTables") }}</p>
        <div class="max-h-40 overflow-auto rounded-md border">
          <table class="w-full text-sm text-left">
            <thead class="sticky top-0 bg-muted">
              <tr>
                <th class="p-2">{{ t("foreignServer.schema") }}</th>
                <th class="p-2">{{ t("foreignServer.table") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="table in server.foreign_tables" :key="`${table.schema}.${table.name}`" class="border-t">
                <td class="p-2 break-all font-mono">{{ table.schema }}</td>
                <td class="p-2 break-all font-mono">{{ table.name }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!server.foreign_tables.length" class="p-3 text-sm text-muted-foreground">{{ t("foreignServer.noTables") }}</p>
        </div>
      </div>

      <div>
        <p class="mb-1.5 text-sm font-medium text-foreground">{{ t("contextMenu.viewDdl") }}</p>
        <pre class="max-h-48 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-all">{{ createSql }}</pre>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="copySql">{{ t("foreignServer.copySql") }}</Button>
        <Button variant="outline" @click="open = false">{{ t("common.close") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
