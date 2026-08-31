"use client";

import { Button } from "react-bootstrap";
import { useTranslations } from "@/i18n";

export type PaginationControls = {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
};

export const TablePagination = ({ page, hasPrev, hasNext, onPrev, onNext }: PaginationControls) => {
  const t = useTranslations("pagination");

  // Единственная страница — кнопки не нужны.
  if (!hasPrev && !hasNext) return null;

  return (
    <div className="d-flex justify-content-between align-items-center mt-3">
      <Button variant="outline-secondary" size="sm" disabled={!hasPrev} onClick={onPrev}>
        {t("prev")}
      </Button>
      <span className="small text-secondary">{t("page", { page })}</span>
      <Button variant="outline-secondary" size="sm" disabled={!hasNext} onClick={onNext}>
        {t("next")}
      </Button>
    </div>
  );
};
