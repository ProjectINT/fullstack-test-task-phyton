import { Badge } from "react-bootstrap";
import { tOrFallback } from "@/i18n";
import type { AlertLevel, ProcessingStatus, ScanStatus } from "@/lib/types";

type Variant = "success" | "warning" | "danger" | "secondary";

const variants: Record<string, Record<string, Variant>> = {
  processing: {
    uploaded: "secondary",
    processing: "warning",
    processed: "success",
    failed: "danger",
  },
  scan: {
    clean: "success",
    suspicious: "danger",
    failed: "danger",
  },
  level: {
    info: "success",
    warning: "warning",
    critical: "danger",
  },
};

type Props =
  | { kind: "processing"; value: ProcessingStatus; title?: never }
  | { kind: "scan"; value: ScanStatus | null; title?: string | null }
  | { kind: "level"; value: AlertLevel; title?: never };

export const StatusBadge = ({ kind, value, title }: Props) => {
  const key = value ?? "pending";
  return (
    <Badge bg={variants[kind][key] ?? "secondary"} title={title ?? undefined}>
      {tOrFallback(`statuses.${kind}.${key}`, key)}
    </Badge>
  );
};
