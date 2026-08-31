"use client";

import { Alert, Badge, Button, Card, Spinner, Table } from "react-bootstrap";
import { formatDate } from "@/lib/format";
import type { AlertItem } from "@/lib/types";
import { AlertLevelBadge } from "./StatusBadge";
import { TablePagination, type PaginationControls } from "./TablePagination";

type Props = {
  alerts: AlertItem[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  pagination: PaginationControls;
  highlightedFileId: string | null;
  onFileClick: (fileId: string) => void;
};

export function AlertsTable({
  alerts,
  isLoading,
  isRefreshing,
  error,
  pagination,
  highlightedFileId,
  onFileClick,
}: Props) {
  return (
    <Card className="shadow-sm border-0">
      <Card.Header className="bg-white border-0 pt-4 px-4">
        <div className="d-flex justify-content-between align-items-center">
          <h2 className="h5 mb-0">Алерты</h2>
          <div className="d-flex align-items-center gap-2">
            {isRefreshing ? <Spinner animation="border" size="sm" /> : null}
            <Badge bg="secondary">{alerts.length}</Badge>
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
          <>
            <div className={`table-responsive${isRefreshing ? " opacity-50" : ""}`}>
              <Table hover bordered className="align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th>ID</th>
                    <th>File ID</th>
                    <th>Уровень</th>
                    <th>Сообщение</th>
                    <th>Создан</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-4 text-secondary">
                        Алертов пока нет
                      </td>
                    </tr>
                  ) : (
                    alerts.map((item) => (
                      <tr
                        key={item.id}
                        className={
                          item.file_id === highlightedFileId ? "table-warning" : undefined
                        }
                      >
                        <td>{item.id}</td>
                        <td>
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 small text-decoration-none"
                            title="Показать файл в таблице файлов"
                            onClick={() => onFileClick(item.file_id)}
                          >
                            {item.file_id}
                          </Button>
                        </td>
                        <td>
                          <AlertLevelBadge level={item.level} />
                        </td>
                        <td>{item.message}</td>
                        <td>{formatDate(item.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </div>
            <TablePagination {...pagination} />
          </>
        )}
      </Card.Body>
    </Card>
  );
}
