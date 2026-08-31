"use client";

import { Button } from "react-bootstrap";
import { useTranslations } from "@/i18n";

/** Показывается, когда серверный page.tsx не смог загрузить начальные данные. */
export default function Error({ reset }: { reset: () => void }) {
  const t = useTranslations("errorPage");
  return (
    <div className="d-flex flex-column justify-content-center align-items-center min-vh-100 bg-light gap-2">
      <h1 className="h4 mb-0">{t("title")}</h1>
      <p className="text-secondary">{t("description")}</p>
      <Button variant="primary" onClick={reset}>
        {t("retry")}
      </Button>
    </div>
  );
}
