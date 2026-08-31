"use client";

import { useEffect, useRef } from "react";
import { Alert, Badge, Button, Card, Spinner, Table } from "react-bootstrap";
import { useTranslations } from "@/i18n";
import { fileDownloadUrl } from "@/lib/api";
import { formatDate, formatSize } from "@/lib/format";
import type { FileItem } from "@/lib/types";
import { ProcessingStatusBadge, ScanStatusBadge } from "./StatusBadge";
import { TablePagination, type PaginationControls } from "./TablePagination";

type Props = {
  files: FileItem[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  pagination: PaginationControls;
  highlightedFileId: string | null;
  onRename: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
};

export function FilesTable({
  files,
  isLoading,
  isRefreshing,
  error,
  pagination,
  highlightedFileId,
  onRename,
  onDelete,
}: Props) {
  const t = useTranslations("filesTable");
  const highlightedRowRef = useRef<HTMLTableRowElement | null>(null);

  // Прокручиваем к подсвеченному файлу (клик по file_id в таблице алертов).
  useEffect(() => {
    highlightedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedFileId]);

  return (
    <Card className="shadow-sm border-0 mb-4">
      <Card.Header className="bg-white border-0 pt-4 px-4">
        <div className="d-flex justify-content-between align-items-center">
          <h2 className="h5 mb-0">{t("title")}</h2>
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
          <>
            <div className={`table-responsive${isRefreshing ? " opacity-50" : ""}`}>
              <Table hover bordered className="align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th>{t("columns.title")}</th>
                    <th>{t("columns.file")}</th>
                    <th>{t("columns.mime")}</th>
                    <th>{t("columns.size")}</th>
                    <th>{t("columns.status")}</th>
                    <th>{t("columns.scan")}</th>
                    <th>{t("columns.createdAt")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {files.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-4 text-secondary">
                        {t("empty")}
                      </td>
                    </tr>
                  ) : (
                    files.map((file) => (
                      <tr
                        key={file.id}
                        ref={file.id === highlightedFileId ? highlightedRowRef : null}
                        className={file.id === highlightedFileId ? "table-warning" : undefined}
                      >
                        <td>
                          <div className="fw-semibold">{file.title}</div>
                        </td>
                        <td>{file.original_name}</td>
                        <td>{file.mime_type}</td>
                        <td>{formatSize(file.size)}</td>
                        <td>
                          <ProcessingStatusBadge status={file.processing_status} />
                        </td>
                        <td>
                          <ScanStatusBadge
                            status={file.scan_status}
                            details={file.scan_details}
                          />
                        </td>
                        <td>{formatDate(file.created_at)}</td>
                        <td className="text-nowrap">
                          <div className="d-flex gap-1">
                            <Button
                              as="a"
                              href={fileDownloadUrl(file.id)}
                              variant="outline-primary"
                              size="sm"
                            >
                              {t("download")}
                            </Button>
                            <Button
                              variant="outline-secondary"
                              size="sm"
                              onClick={() => onRename(file)}
                            >
                              {t("rename")}
                            </Button>
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={() => onDelete(file)}
                            >
                              {t("delete")}
                            </Button>
                          </div>
                        </td>
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
