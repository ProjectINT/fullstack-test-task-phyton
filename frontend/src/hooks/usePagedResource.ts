"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PageParams } from "@/lib/api";

type Fetcher<T> = (params: PageParams) => Promise<T[]>;

export type PagedResource<T> = {
  items: T[];
  /** Первая загрузка: данных ещё нет, таблицу заменяет спиннер. */
  isLoading: boolean;
  /** Повторная загрузка: данные уже показаны, таблица не скрывается. */
  isRefreshing: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

export function usePagedResource<T>(fetcher: Fetcher<T>): PagedResource<T> {
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(
    (controller: AbortController) =>
      fetcher({ signal: controller.signal })
        .then((data) => {
          if (controller.signal.aborted) return;
          setItems(data);
          setError(null);
          hasLoadedRef.current = true;
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : "Произошла ошибка");
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoading(false);
            setIsRefreshing(false);
          }
        }),
    [fetcher]
  );

  // Начальная загрузка: isLoading уже true, поэтому эффект ничего не выставляет синхронно.
  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void load(controller);
    return () => controller.abort();
  }, [load]);

  const refetch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (hasLoadedRef.current) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    await load(controller);
  }, [load]);

  return { items, isLoading, isRefreshing, error, refetch };
}
