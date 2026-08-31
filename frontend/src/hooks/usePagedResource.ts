"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PageParams } from "@/lib/api";
import { isAbortError, toUserMessage } from "@/lib/errors";

const DEFAULT_PAGE_SIZE = 20;

type Fetcher<T> = (params: PageParams) => Promise<T[]>;

export type RefetchOptions = {
  /** Тихое обновление (поллинг): без спиннеров и затемнения таблицы. */
  silent?: boolean;
};

export type PagedResource<T> = {
  items: T[];
  /** Первая загрузка: данных ещё нет, таблицу заменяет спиннер. */
  isLoading: boolean;
  /** Повторная загрузка: данные уже показаны, таблица не скрывается. */
  isRefreshing: boolean;
  error: string | null;
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  prevPage: () => void;
  nextPage: () => void;
  refetch: (options?: RefetchOptions) => Promise<void>;
};

export function usePagedResource<T>(
  fetcher: Fetcher<T>,
  pageSize = DEFAULT_PAGE_SIZE
): PagedResource<T> {
  const [items, setItems] = useState<T[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(
    (controller: AbortController) =>
      // Запрашиваем на один элемент больше, чтобы узнать, есть ли следующая страница.
      fetcher({ limit: pageSize + 1, offset, signal: controller.signal })
        .then((data) => {
          if (controller.signal.aborted) return;
          if (data.length === 0 && offset > 0) {
            // Страница опустела (например, после удаления) — возвращаемся назад.
            setOffset(Math.max(0, offset - pageSize));
            return;
          }
          setHasNext(data.length > pageSize);
          setItems(data.slice(0, pageSize));
          setError(null);
          hasLoadedRef.current = true;
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || isAbortError(err)) return;
          setError(toUserMessage(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoading(false);
            setIsRefreshing(false);
          }
        }),
    [fetcher, pageSize, offset]
  );

  // Начальная загрузка и перезагрузка при смене страницы.
  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (hasLoadedRef.current) {
      setIsRefreshing(true);
    }
    void load(controller);
    return () => controller.abort();
  }, [load]);

  const refetch = useCallback(
    async ({ silent = false }: RefetchOptions = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!silent) {
        if (hasLoadedRef.current) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
        setError(null);
      }

      await load(controller);
    },
    [load]
  );

  const prevPage = useCallback(
    () => setOffset((prev) => Math.max(0, prev - pageSize)),
    [pageSize]
  );
  const nextPage = useCallback(
    () => setOffset((prev) => prev + pageSize),
    [pageSize]
  );

  return {
    items,
    isLoading,
    isRefreshing,
    error,
    page: Math.floor(offset / pageSize) + 1,
    hasPrev: offset > 0,
    hasNext,
    prevPage,
    nextPage,
    refetch,
  };
}
