"use client";

import { FormEvent, useState } from "react";
import { Alert, Button, Form, Modal } from "react-bootstrap";
import { useTranslations } from "@/i18n";
import { uploadFile } from "@/lib/api";
import { toUserMessage } from "@/lib/errors";

type Props = {
  show: boolean;
  onClose: () => void;
  onUploaded: () => void;
};

export function UploadModal({ show, onClose, onUploaded }: Props) {
  const t = useTranslations("uploadModal");
  const tCommon = useTranslations("common");
  const [title, setTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleClose() {
    setTitle("");
    setSelectedFile(null);
    setFormError(null);
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim() || !selectedFile) {
      setFormError(t("validation"));
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      await uploadFile(title.trim(), selectedFile);
      handleClose();
      onUploaded();
    } catch (error) {
      setFormError(toUserMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal show={show} onHide={handleClose} centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>{t("title")}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {formError ? <Alert variant="danger">{formError}</Alert> : null}
          <Form.Group className="mb-3">
            <Form.Label>{t("titleLabel")}</Form.Label>
            <Form.Control
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("titlePlaceholder")}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label>{t("fileLabel")}</Form.Label>
            <Form.Control
              type="file"
              onChange={(event) =>
                setSelectedFile((event.target as HTMLInputElement).files?.[0] ?? null)
              }
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
