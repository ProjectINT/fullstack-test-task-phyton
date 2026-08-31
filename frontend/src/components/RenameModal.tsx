"use client";

import { FormEvent, useState } from "react";
import { Alert, Button, Form, Modal } from "react-bootstrap";
import { useTranslations } from "@/i18n";
import { renameFile } from "@/lib/api";
import { toUserMessage } from "@/lib/errors";
import type { FileItem } from "@/lib/types";

type Props = {
  file: FileItem | null;
  onClose: () => void;
  onRenamed: () => void;
};

export function RenameModal({ file, onClose, onRenamed }: Props) {
  const t = useTranslations("renameModal");
  const tCommon = useTranslations("common");
  // null — пользователь ещё не редактировал поле, показываем текущее название файла.
  const [title, setTitle] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayedTitle = title ?? file?.title ?? "";

  function handleClose() {
    setTitle(null);
    setFormError(null);
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;

    const trimmedTitle = displayedTitle.trim();
    if (!trimmedTitle) {
      setFormError(t("validation"));
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      await renameFile(file.id, trimmedTitle);
      handleClose();
      onRenamed();
    } catch (error) {
      setFormError(toUserMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal show={file !== null} onHide={handleClose} centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>{t("title")}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {formError ? <Alert variant="danger">{formError}</Alert> : null}
          <Form.Group>
            <Form.Label>{t("titleLabel")}</Form.Label>
            <Form.Control
              value={displayedTitle}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={handleClose}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? t("submitting") : tCommon("save")}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
