// Единственный источник правды — контракт бэкенда: src/api/schema.d.ts
// пересобирается из backend/openapi.json командой `npm run gen:api`
// (CI проверяет дрифт через `npm run gen:api:check`).
export type {
  AlertItem,
  AlertLevel,
  FileItem,
  FileUpdate,
  ProcessingStatus,
  ScanStatus,
} from "@/api/types";
