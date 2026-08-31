"use client";

import { Button } from "react-bootstrap";

export type PaginationControls = {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
};

export function TablePagination({ page, hasPrev, hasNext, onPrev, onNext }: PaginationControls) {
  // Единственная страница — кнопки не нужны.
  if (!hasPrev && !hasNext) return null;

  return (
    <div className="d-flex justify-content-between align-items-center mt-3">
      <Button variant="outline-secondary" size="sm" disabled={!hasPrev} onClick={onPrev}>
        ← Назад
      </Button>
      <span className="small text-secondary">Страница {page}</span>
      <Button variant="outline-secondary" size="sm" disabled={!hasNext} onClick={onNext}>
        Вперёд →
      </Button>
    </div>
  );
}
