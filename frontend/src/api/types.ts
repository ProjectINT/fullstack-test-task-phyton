// Псевдонимы к сгенерированной схеме. Файл schema.d.ts не редактируется руками:
// он пересобирается из backend/openapi.json командой `npm run gen:api`.
import type { components } from "./schema";

type Schemas = components["schemas"];

export type FileItem = Schemas["FileItem"];
export type FileUpdate = Schemas["FileUpdate"];
export type AlertItem = Schemas["AlertItem"];
export type ProcessingStatus = Schemas["ProcessingStatus"];
export type ScanStatus = Schemas["ScanStatus"];
export type AlertLevel = Schemas["AlertLevel"];
