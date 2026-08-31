"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PAGE_SIZE, type PageParams } from "@/lib/api";
import { isAbortError, toUserMessage } from "@/lib/errors";

type Fetcher<T> = (params: PageParams) => Promise<T[]>;

export type RefetchOptions = {
  /** Тихое обновление (поллинг): без спиннера и затемнения таблицы. */
  silent?: boolean;
};

export type PagedResource<T> = {
  items: T[];
  /** Перезагрузка: данные уже показаны, таблица не скрывается. */
  isRefreshing: boolean;
  error: string | null;
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  prevPage: () => void;
  nextPage: () => void;
  refetch: (options?: RefetchOptions) => Promise<void>;
};

/**
 * Пагинация поверх начальных данных, загруженных серверным компонентом
 * (app/page.tsx): первая отрисовка обходится без спиннера и запроса с клиента.
 *
 * `initialData` — сырая выборка размером pageSize + 1: лишний элемент
 * означает, что есть следующая страница (тот же приём в load ниже).
 */
export const usePagedResource = <T>(
  fetcher: Fetcher<T>,
  initialData: T[],
  pageSize = DEFAULT_PAGE_SIZE
): PagedResource<T> => {
  const [items, setItems] = useState<T[]>(() => initialData.slice(0, pageSize));
  const [offset, setOffset] = useState(0);
  const [hasNext, setHasNext] = useState(initialData.length > pageSize);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Первую страницу уже загрузил сервер — первый запуск эффекта пропускаем.
  const hasServerDataRef = useRef(true);

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
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || isAbortError(err)) return;
          setError(toUserMessage(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsRefreshing(false);
          }
        }),
    [fetcher, pageSize, offset]
  );

  // Перезагрузка при смене страницы.
  useEffect(() => {
    if (hasServerDataRef.current) {
      hasServerDataRef.current = false;
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRefreshing(true);
    void load(controller);
    return () => controller.abort();
  }, [load]);

  const refetch = useCallback(
    async ({ silent = false }: RefetchOptions = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!silent) {
        setIsRefreshing(true);
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
    isRefreshing,
    error,
    page: Math.floor(offset / pageSize) + 1,
    hasPrev: offset > 0,
    hasNext,
    prevPage,
    nextPage,
    refetch,
  };
};
