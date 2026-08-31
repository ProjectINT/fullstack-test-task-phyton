/**
 * Минимальный словарь переводов.
 *
 * Все строки интерфейса лежат в messages/ru.json (формат совместим с
 * next-intl: неймспейсы + плейсхолдеры вида {param}). API повторяет
 * next-intl — `useTranslations(namespace)` в компонентах и `t("ns.key")`
 * вне React — поэтому подключение полноценной i18n-библиотеки позже
 * сведётся к замене этого модуля, без правки call-site'ов.
 */

import ru from "./messages/ru.json";

const messages = ru;

type Messages = typeof messages;

/** Значения для подстановки в плейсхолдеры {param}. */
export type TranslationValues = Record<string, string | number | null | undefined>;

/** Все "листовые" ключи словаря в точечной нотации: "filesTable.columns.title". */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;
export type Namespace = keyof Messages;

function resolve(key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === null || value === undefined ? placeholder : String(value);
  });
}

/** Перевод по полному ключу — для кода вне React (errors.ts, format.ts, metadata). */
export function t(key: MessageKey, values?: TranslationValues): string {
  const template = resolve(key);
  // Отсутствующий ключ не роняет UI — показываем сам ключ (как next-intl в production).
  return template === undefined ? key : interpolate(template, values);
}

/**
 * Перевод по ключу без гарантии, что он есть в словаре, — для строк,
 * приходящих из данных (статусы, уровни алертов). Нет в словаре — вернёт fallback.
 */
export function tOrFallback(key: string, fallback: string): string {
  return resolve(key) ?? fallback;
}

/** Скоуп-переводчик в стиле next-intl: const t = useTranslations("uploadModal"). */
export function useTranslations<N extends Namespace>(namespace: N) {
  return (key: Leaves<Messages[N]>, values?: TranslationValues) =>
    t(`${namespace}.${key}` as MessageKey, values);
}
