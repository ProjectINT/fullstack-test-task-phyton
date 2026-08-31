"use client";

import { FormEvent, useState } from "react";
import { Alert, Button, Form, Modal } from "react-bootstrap";
import { renameFile } from "@/lib/api";
import type { FileItem } from "@/lib/types";

type Props = {
  file: FileItem | null;
  onClose: () => void;
  onRenamed: () => void;
};

export function RenameModal({ file, onClose, onRenamed }: Props) {
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
      setFormError("Укажите название");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      await renameFile(file.id, trimmedTitle);
      handleClose();
      onRenamed();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Произошла ошибка");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal show={file !== null} onHide={handleClose} centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>Переименовать файл</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {formError ? <Alert variant="danger">{formError}</Alert> : null}
          <Form.Group>
            <Form.Label>Название</Form.Label>
            <Form.Control
              value={displayedTitle}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={handleClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Сохранение..." : "Сохранить"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
