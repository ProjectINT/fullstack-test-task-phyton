import { Api, FileItem } from "../src/api";
import { DashboardPage, UploadFile, expect, test, uniqueTitle } from "../src/fixtures";
import { TestFileKey, testFile } from "../src/test-files";

/**
 * Правила скана живут в `backend/src/files/service.py::_scan_for_threats`:
 * подозрительное расширение, размер > 10 МБ, `.pdf` с чужим MIME.
 * Причины склеиваются через «, » в том порядке, в каком проверяются.
 */
const REASON = {
  exe: "suspicious extension .exe",
  js: "suspicious extension .js",
  size: "file is larger than 10 MB",
  pdfMime: "pdf extension does not match mime type",
} as const;

/** Бэкенд подтвердил: файл обработан, помечен suspicious, алерт — warning. */
async function expectSuspiciousInApi(api: Api, file: FileItem, details: string): Promise<FileItem> {
  const processed = await api.waitForProcessed(file.id);
  expect(processed.scan_status).toBe("suspicious");
  expect(processed.scan_details).toBe(details);
  expect(processed.requires_attention).toBe(true);

  const alert = await api.waitForAlert(file.id);
  expect(alert.level).toBe("warning");
  expect(alert.message).toBe(`File requires attention: ${details}`);

  return processed;
}

/**
 * То же самое глазами пользователя. Вызывать после того, как API подтвердил
 * терминальный статус, — иначе одного «Обновить» может не хватить.
 */
async function expectSuspiciousInUi(
  dashboard: DashboardPage,
  title: string,
  details: string,
): Promise<void> {
  await dashboard.refresh();

  const row = dashboard.fileRow(title);
  await expect(row.root).toBeVisible();
  await expect(row.status).toHaveText("processed");
  await expect(row.status).toHaveClass(/bg-success/);

  await expect(row.scan).toHaveText("suspicious");
  // StatusBadge мапит scan.suspicious → danger, поэтому бейдж красный, не жёлтый.
  await expect(row.scan).toHaveClass(/bg-danger/);
  // scan_details целиком уезжают в тултип бейджа.
  await expect(row.scan).toHaveAttribute("title", details);

  const alertRow = dashboard.alertRow(title);
  await expect(alertRow.root).toBeVisible();
  await expect(alertRow.level).toHaveText("warning");
  await expect(alertRow.level).toHaveClass(/bg-warning/);
  await expect(alertRow.message).toHaveText(`File requires attention: ${details}`);
}

type ScanContext = { api: Api; dashboard: DashboardPage; uploadFile: UploadFile };

/** Общий сценарий «залить фикстуру через API → проверить бэкенд и UI». */
async function checkFixture(
  { api, dashboard, uploadFile }: ScanContext,
  fixture: TestFileKey,
  details: string,
): Promise<void> {
  const created = await uploadFile({ fixture, label: fixture });
  await expectSuspiciousInApi(api, created, details);
  await expectSuspiciousInUi(dashboard, created.title, details);
}

test.describe("phase 3: сценарии скана (подозрительные файлы)", () => {
  test("malware.exe, загруженный через UI, помечается suspicious", async ({
    api,
    dashboard,
  }, testInfo) => {
    const exe = testFile("exe");
    const title = uniqueTitle(testInfo, "exe-ui");

    const row = await dashboard.uploadViaUi({ title, filePath: exe.path });
    await expect(row.originalName).toHaveText(exe.name);

    // id известен только бэкенду — находим запись по уникальному title.
    const file = await api.waitForFileByTitle(title);
    await expectSuspiciousInApi(api, file, REASON.exe);

    await dashboard.refreshUntilStatus(row, "processed");
    await expectSuspiciousInUi(dashboard, title, REASON.exe);
  });

  test("script.js помечается suspicious по расширению .js", async ({
    api,
    dashboard,
    uploadFile,
  }) => {
    await checkFixture({ api, dashboard, uploadFile }, "js", REASON.js);
  });

  test("файл больше 10 МБ помечается suspicious по размеру", async ({
    api,
    dashboard,
    uploadFile,
  }) => {
    test.slow(); // 11 МБ: заливка + обработка заметно дольше обычного теста.
    await checkFixture({ api, dashboard, uploadFile }, "big", REASON.size);
  });

  test(".pdf с MIME text/plain помечается suspicious по несовпадению типа", async ({
    api,
    dashboard,
    uploadFile,
  }) => {
    // Браузер сам ставит application/pdf, подменить MIME можно только через API.
    const created = await uploadFile({
      fixture: "pdf",
      label: "pdf-mime",
      mimeType: "text/plain",
    });
    expect(created.mime_type).toBe("text/plain");
    expect(created.original_name).toBe(testFile("pdf").name);

    await expectSuspiciousInApi(api, created, REASON.pdfMime);
    await expectSuspiciousInUi(dashboard, created.title, REASON.pdfMime);
  });

  test("две причины сразу (.exe больше 10 МБ) перечислены в scan_details", async ({
    api,
    dashboard,
    uploadFile,
  }) => {
    test.slow();

    const details = `${REASON.exe}, ${REASON.size}`;
    const created = await uploadFile({ fixture: "bigExe", label: "big-exe" });

    const processed = await expectSuspiciousInApi(api, created, details);
    expect(processed.scan_details).toContain(REASON.exe);
    expect(processed.scan_details).toContain(REASON.size);

    await expectSuspiciousInUi(dashboard, created.title, details);
  });

  test("чистый файл не попадает под правила скана", async ({ api, uploadedFile }) => {
    // Контрольная точка: те же проверки на clean.txt дают clean + info-алерт.
    expect(uploadedFile.scan_status).toBe("clean");
    expect(uploadedFile.scan_details).toBe("no threats found");
    expect(uploadedFile.requires_attention).toBe(false);

    const alert = await api.waitForAlert(uploadedFile.id);
    expect(alert.level).toBe("info");
    expect(alert.message).toBe("File processed successfully");
  });
});
