import fs from "node:fs";
import path from "node:path";

import { FIXTURES_DIR } from "./config";

const MB = 1024 * 1024;

/**
 * Минимальный PDF с маркерами `/Type /Page` — бэкенд по ним считает
 * `approx_page_count` (см. `_PdfPageAnalyzer`).
 */
const PDF_CONTENT = [
  "%PDF-1.4",
  "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
  "2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj",
  "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj",
  "4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj",
  "trailer << /Root 1 0 R /Size 5 >>",
  "%%EOF",
  "",
].join("\n");

type FixtureSpec = {
  /** Имя файла на диске — оно же уходит в `original_name`. */
  name: string;
  /** MIME, который выставит браузер / который стоит слать через API. */
  mimeType: string;
  /** Контент; функция — чтобы 11 МБ не висели в памяти без нужды. */
  build: () => Buffer;
  /** Не материализовать в globalSetup: слишком тяжёлый, нужен паре тестов. */
  lazy?: boolean;
};

const SPECS = {
  clean: {
    name: "clean.txt",
    mimeType: "text/plain",
    build: () => Buffer.from("hello e2e\nsecond line\nthird line\n", "utf8"),
  },
  pdf: {
    name: "document.pdf",
    mimeType: "application/pdf",
    build: () => Buffer.from(PDF_CONTENT, "latin1"),
  },
  exe: {
    name: "malware.exe",
    mimeType: "application/octet-stream",
    // MZ-заголовок, чтобы файл выглядел как настоящий PE, а не как текст.
    build: () => Buffer.concat([Buffer.from("MZ"), Buffer.alloc(1022, 0x90)]),
  },
  js: {
    name: "script.js",
    mimeType: "text/javascript",
    build: () => Buffer.from("console.log('e2e');\n", "utf8"),
  },
  empty: {
    name: "empty.txt",
    mimeType: "text/plain",
    build: () => Buffer.alloc(0),
  },
  big: {
    name: "big-11mb.bin",
    mimeType: "application/octet-stream",
    // > SUSPICIOUS_SIZE_BYTES (10 МБ), но < max_file_size (100 МБ).
    build: () => Buffer.alloc(11 * MB, 0x41),
  },
  huge: {
    name: "huge-101mb.bin",
    mimeType: "application/octet-stream",
    // > max_file_size (100 МБ) — бэкенд обрывает загрузку с 413.
    build: () => Buffer.alloc(101 * MB, 0x41),
    lazy: true,
  },
  bigExe: {
    name: "big-malware.exe",
    mimeType: "application/octet-stream",
    // Комбинация двух причин: подозрительное расширение + размер.
    build: () => Buffer.concat([Buffer.from("MZ"), Buffer.alloc(11 * MB, 0x90)]),
  },
} as const satisfies Record<string, FixtureSpec>;

export type TestFileKey = keyof typeof SPECS;

export type TestFile = {
  key: TestFileKey;
  name: string;
  mimeType: string;
  path: string;
  size: number;
};

const specPath = (spec: FixtureSpec): string => {
  return path.join(FIXTURES_DIR, spec.name);
};

/**
 * Пишет файл на диск, если его ещё нет или размер разошёлся с ожидаемым.
 * Идемпотентно: повторные прогоны не переписывают 11 МБ заново.
 */
const materialize = (key: TestFileKey, spec: FixtureSpec): TestFile => {
  const filePath = specPath(spec);
  const content = spec.build();
  const current = fs.existsSync(filePath) ? fs.statSync(filePath) : null;

  if (!current || current.size !== content.length) {
    fs.writeFileSync(filePath, content);
  }

  return {
    key,
    name: spec.name,
    mimeType: spec.mimeType,
    path: filePath,
    size: content.length,
  };
};

/** Создаёт фикстуры на диске (кроме `lazy`). Вызывается из globalSetup. */
export const ensureTestFiles = (): Partial<Record<TestFileKey, TestFile>> => {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  const result: Partial<Record<TestFileKey, TestFile>> = {};
  for (const [key, spec] of Object.entries(SPECS) as [TestFileKey, FixtureSpec][]) {
    if (spec.lazy) continue;
    result[key] = materialize(key, spec);
  }
  return result;
};

/**
 * Дескриптор фикстуры для использования в тесте. Файл материализуется лениво,
 * так что тест работает и без предварительного globalSetup (например, под `--ui`).
 */
export const testFile = (key: TestFileKey): TestFile => {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  return materialize(key, SPECS[key]);
};

/** Содержимое фикстуры — для побайтового сравнения при скачивании (фаза 5). */
export const testFileContent = (key: TestFileKey): Buffer => {
  return SPECS[key].build();
};

export const testFileKeys = Object.keys(SPECS) as TestFileKey[];
