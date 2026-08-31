"use client";

import { Alert, Badge, Button, Card, Spinner, Table } from "react-bootstrap";
import { fileDownloadUrl } from "@/lib/api";
import { formatDate, formatSize } from "@/lib/format";
import type { FileItem } from "@/lib/types";
import { ProcessingStatusBadge, ScanStatusBadge } from "./StatusBadge";

type Props = {
  files: FileItem[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
};

export function FilesTable({ files, isLoading, isRefreshing, error }: Props) {
  return (
    <Card className="shadow-sm border-0 mb-4">
      <Card.Header className="bg-white border-0 pt-4 px-4">
        <div className="d-flex justify-content-between align-items-center">
          <h2 className="h5 mb-0">Файлы</h2>
          <div className="d-flex align-items-center gap-2">
            {isRefreshing ? <Spinner animation="border" size="sm" /> : null}
            <Badge bg="secondary">{files.length}</Badge>
          </div>
        </div>
      </Card.Header>
      <Card.Body className="px-4 pb-4">
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {isLoading ? (
          <div className="d-flex justify-content-center py-5">
            <Spinner animation="border" />
          </div>
        ) : (
          <div className={`table-responsive${isRefreshing ? " opacity-50" : ""}`}>
            <Table hover bordered className="align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th>Название</th>
                  <th>Файл</th>
                  <th>MIME</th>
                  <th>Размер</th>
                  <th>Статус</th>
                  <th>Проверка</th>
                  <th>Создан</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {files.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-4 text-secondary">
                      Файлы пока не загружены
                    </td>
                  </tr>
                ) : (
                  files.map((file) => (
                    <tr key={file.id}>
                      <td>
                        <div className="fw-semibold">{file.title}</div>
                        <div className="small text-secondary">{file.id}</div>
                      </td>
                      <td>{file.original_name}</td>
                      <td>{file.mime_type}</td>
                      <td>{formatSize(file.size)}</td>
                      <td>
                        <ProcessingStatusBadge status={file.processing_status} />
                      </td>
                      <td>
                        <div className="d-flex flex-column gap-1">
                          <ScanStatusBadge status={file.scan_status} />
                          <span className="small text-secondary">
                            {file.scan_details ?? "Ожидает обработки"}
                          </span>
                        </div>
                      </td>
                      <td>{formatDate(file.created_at)}</td>
                      <td className="text-nowrap">
                        <Button
                          as="a"
                          href={fileDownloadUrl(file.id)}
                          variant="outline-primary"
                          size="sm"
                        >
                          Скачать
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
