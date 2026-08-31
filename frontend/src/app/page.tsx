import { Dashboard } from "@/components/Dashboard";
import { DEFAULT_PAGE_SIZE, getAlerts, getFiles } from "@/lib/api";

// Списки живые (статусы меняет воркер) — рендерим страницу на каждый запрос
// и не пререндерим её на билде, когда бэкенд недоступен.
export const dynamic = "force-dynamic";

const Page = async () => {
  // +1 элемент — чтобы клиент знал, есть ли следующая страница (см. usePagedResource).
  const pageParams = { limit: DEFAULT_PAGE_SIZE + 1, offset: 0 };
  const [initialFiles, initialAlerts] = await Promise.all([
    getFiles(pageParams),
    getAlerts(pageParams),
  ]);

  // Если бэкенд недоступен, промисы выше отклонятся — покажется app/error.tsx.
  return <Dashboard initialFiles={initialFiles} initialAlerts={initialAlerts} />;
};

export default Page;
