"use client";

import { useState } from "react";
import { Alert, Button, Modal } from "react-bootstrap";
import { useTranslations } from "@/i18n";
import { deleteFile } from "@/lib/api";
import { toUserMessage } from "@/lib/errors";
import type { FileItem } from "@/lib/types";

type Props = {
  file: FileItem | null;
  onClose: () => void;
  onDeleted: () => void;
};

export function ConfirmDeleteModal({ file, onClose, onDeleted }: Props) {
  const t = useTranslations("deleteModal");
  const tCommon = useTranslations("common");
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
      setError(toUserMessage(err));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Modal show={file !== null} onHide={handleClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>{t("title")}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <p className="mb-0">{t("confirmation", { title: file?.title })}</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={handleClose}>
          {tCommon("cancel")}
        </Button>
        <Button variant="danger" onClick={handleDelete} disabled={isDeleting}>
          {isDeleting ? t("submitting") : t("confirm")}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
