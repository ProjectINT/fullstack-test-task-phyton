"use client";

import { useState } from "react";
import { Button, Card, Col, Container, Row } from "react-bootstrap";
import { AlertsTable } from "@/components/AlertsTable";
import { FilesTable } from "@/components/FilesTable";
import { UploadModal } from "@/components/UploadModal";
import { usePagedResource } from "@/hooks/usePagedResource";
import { getAlerts, getFiles } from "@/lib/api";

export default function Page() {
  const files = usePagedResource(getFiles);
  const alerts = usePagedResource(getAlerts);
  const [showModal, setShowModal] = useState(false);

  function refetchAll() {
    void files.refetch();
    void alerts.refetch();
  }

  return (
    <Container fluid className="py-4 px-4 bg-light min-vh-100">
      <Row className="justify-content-center">
        <Col xxl={10} xl={11}>
          <Card className="shadow-sm border-0 mb-4">
            <Card.Body className="p-4">
              <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                <div>
                  <h1 className="h3 mb-2">Управление файлами</h1>
                  <p className="text-secondary mb-0">
                    Загрузка файлов, просмотр статусов обработки и ленты алертов.
                  </p>
                </div>
                <div className="d-flex gap-2">
                  <Button variant="outline-secondary" onClick={refetchAll}>
                    Обновить
                  </Button>
                  <Button variant="primary" onClick={() => setShowModal(true)}>
                    Добавить файл
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
          />

          <AlertsTable
            alerts={alerts.items}
            isLoading={alerts.isLoading}
            isRefreshing={alerts.isRefreshing}
            error={alerts.error}
          />
        </Col>
      </Row>

      <UploadModal
        show={showModal}
        onClose={() => setShowModal(false)}
        onUploaded={refetchAll}
      />
    </Container>
  );
}
