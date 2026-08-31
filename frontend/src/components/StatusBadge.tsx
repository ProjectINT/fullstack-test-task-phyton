import { Badge } from "react-bootstrap";
import { tOrFallback } from "@/i18n";
import type { AlertLevel, ProcessingStatus, ScanStatus } from "@/lib/types";

type Variant = "success" | "warning" | "danger" | "secondary";

const processingVariants: Record<ProcessingStatus, Variant> = {
  uploaded: "secondary",
  processing: "warning",
  processed: "success",
  failed: "danger",
};

const scanVariants: Record<ScanStatus, Variant> = {
  clean: "success",
  suspicious: "danger",
  failed: "danger",
};

const levelVariants: Record<AlertLevel, Variant> = {
  info: "success",
  warning: "warning",
  critical: "danger",
};

export function ProcessingStatusBadge({ status }: { status: ProcessingStatus }) {
  return (
    <Badge bg={processingVariants[status] ?? "secondary"}>
      {tOrFallback(`statuses.processing.${status}`, status)}
    </Badge>
  );
}

export function ScanStatusBadge({
  status,
  details,
}: {
  status: ScanStatus | null;
  details?: string | null;
}) {
  return (
    <Badge
      bg={status ? scanVariants[status] ?? "secondary" : "secondary"}
      title={details ?? undefined}
    >
      {tOrFallback(`statuses.scan.${status ?? "pending"}`, status ?? "pending")}
    </Badge>
  );
}

export function AlertLevelBadge({ level }: { level: AlertLevel }) {
  return (
    <Badge bg={levelVariants[level] ?? "secondary"}>
      {tOrFallback(`statuses.level.${level}`, level)}
    </Badge>
  );
}
