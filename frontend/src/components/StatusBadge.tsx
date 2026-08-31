import { Badge } from "react-bootstrap";
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
  return <Badge bg={processingVariants[status] ?? "secondary"}>{status}</Badge>;
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
      {status ?? "pending"}
    </Badge>
  );
}

export function AlertLevelBadge({ level }: { level: AlertLevel }) {
  return <Badge bg={levelVariants[level] ?? "secondary"}>{level}</Badge>;
}
