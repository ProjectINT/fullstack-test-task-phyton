"use client";

import { useEffect, useState } from "react";
import { Button, Card, Col, Container, Row } from "react-bootstrap";
import { AlertsTable } from "@/components/AlertsTable";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { FilesTable } from "@/components/FilesTable";
import { RenameModal } from "@/components/RenameModal";
import { UploadModal } from "@/components/UploadModal";
import { usePagedResource } from "@/hooks/usePagedResource";
import { useTranslations } from "@/i18n";
import { getAlerts, getFiles } from "@/lib/api";
import type { FileItem } from "@/lib/types";

const POLL_INTERVAL_MS = 4000;

export default function Page() {
  const t = useTranslations("page");
  const files = usePagedResource(getFiles);
  const alerts = usePagedResource(getAlerts);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [fileToRename, setFileToRename] = useState<FileItem | null>(null);
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null);
  const [highlightedFileId, setHighlightedFileId] = useState<string | null>(null);

  function refetchAll() {
    void files.refetch();
    void alerts.refetch();
  }

  // Пока есть файлы в нетерминальных статусах — тихо обновляем обе таблицы,
  // чтобы статусы и алерты подтягивались без ручного «Обновить».
  const hasPendingFiles = files.items.some(
    (file) =>
      file.processing_status === "uploaded" || file.processing_status === "processing"
  );
  const refetchFiles = files.refetch;
  const refetchAlerts = alerts.refetch;

  useEffect(() => {
    if (!hasPendingFiles) return;
    const intervalId = setInterval(() => {
      void refetchFiles({ silent: true });
      void refetchAlerts({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [hasPendingFiles, refetchFiles, refetchAlerts]);

  return (
    <Container fluid className="py-4 px-4 bg-light min-vh-100">
      <Row className="justify-content-center">
        <Col xxl={10} xl={11}>
          <Card className="shadow-sm border-0 mb-4">
            <Card.Body className="p-4">
              <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                <div>
                  <h1 className="h3 mb-2">{t("title")}</h1>
                  <p className="text-secondary mb-0">{t("subtitle")}</p>
                </div>
                <div className="d-flex gap-2">
                  <Button variant="outline-secondary" onClick={refetchAll}>
                    {t("refresh")}
                  </Button>
                  <Button variant="primary" onClick={() => setShowUploadModal(true)}>
                    {t("addFile")}
                  </Button>
                </div>
              </div>
            </Card.Body>
          </Card>

          <FilesTable
            files={files.items}
            isLoading={files.isLoading}
            isRefreshing={files.isRefreshing}
            error={files.error}
            pagination={{
              page: files.page,
              hasPrev: files.hasPrev,
              hasNext: files.hasNext,
              onPrev: files.prevPage,
              onNext: files.nextPage,
            }}
            highlightedFileId={highlightedFileId}
            onRename={setFileToRename}
            onDelete={setFileToDelete}
          />

          <AlertsTable
            alerts={alerts.items}
            isLoading={alerts.isLoading}
            isRefreshing={alerts.isRefreshing}
            error={alerts.error}
            pagination={{
              page: alerts.page,
              hasPrev: alerts.hasPrev,
              hasNext: alerts.hasNext,
              onPrev: alerts.prevPage,
              onNext: alerts.nextPage,
            }}
            highlightedFileId={highlightedFileId}
            onFileClick={(fileId) =>
              setHighlightedFileId((prev) => (prev === fileId ? null : fileId))
            }
          />
        </Col>
      </Row>

      <UploadModal
        show={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploaded={refetchAll}
      />

      <RenameModal
        file={fileToRename}
        onClose={() => setFileToRename(null)}
        onRenamed={() => void files.refetch()}
      />

      <ConfirmDeleteModal
        file={fileToDelete}
        onClose={() => setFileToDelete(null)}
        // Алерты удалённого файла тоже пропадают — обновляем обе таблицы.
        onDeleted={refetchAll}
      />
    </Container>
  );
}
