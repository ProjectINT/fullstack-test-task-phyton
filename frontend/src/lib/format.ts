import { t } from "@/i18n";

export const formatDate = (value: string) => {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
};

export const formatSize = (size: number) => {
  if (size < 1024) {
    return t("format.bytes", { value: size });
  }

  if (size < 1024 * 1024) {
    return t("format.kilobytes", { value: (size / 1024).toFixed(1) });
  }

  return t("format.megabytes", { value: (size / (1024 * 1024)).toFixed(1) });
};
