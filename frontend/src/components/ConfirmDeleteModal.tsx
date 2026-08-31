"use client";

import { useState } from "react";
import { Alert, Button, Modal } from "react-bootstrap";
import { deleteFile } from "@/lib/api";
import type { FileItem } from "@/lib/types";

type Props = {
  file: FileItem | null;
  onClose: () => void;
  onDeleted: () => void;
};

export function ConfirmDeleteModal({ file, onClose, onDeleted }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function handleClose() {
    setError(null);
    onClose();
  }

  async function handleDelete() {
    if (!file) return;

    setIsDeleting(true);
    setError(null);

    try {
      await deleteFile(file.id);
      handleClose();
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Произошла ошибка");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Modal show={file !== null} onHide={handleClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Удалить файл</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <p className="mb-0">
          Удалить файл «{file?.title}»? Действие необратимо.
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={handleClose}>
          Отмена
        </Button>
        <Button variant="danger" onClick={handleDelete} disabled={isDeleting}>
          {isDeleting ? "Удаление..." : "Удалить"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
