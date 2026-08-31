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

type PageState<T> = {
  items: T[];
  hasNext: boolean;
};

/**
 * Разбор сырой выборки размером pageSize + 1: лишний элемент означает,
 * что есть следующая страница.
 */
const toPageState = <T>(raw: T[], pageSize: number): PageState<T> => ({
  items: raw.slice(0, pageSize),
  hasNext: raw.length > pageSize,
});

/**
 * Пагинация поверх начальных данных, загруженных серверным компонентом
 * (app/page.tsx): первая отрисовка обходится без спиннера и запроса с клиента.
 *
 * `initialData` — та же сырая выборка pageSize + 1, что возвращает fetcher.
 */
export const usePagedResource = <T>(
  fetcher: Fetcher<T>,
  initialData: T[],
  pageSize = DEFAULT_PAGE_SIZE
): PagedResource<T> => {
  const [{ items, hasNext }, setPageState] = useState<PageState<T>>(() =>
    toPageState(initialData, pageSize)
  );
  const [offset, setOffset] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // fetcher держим в ref: смена его ссылки (инлайновая лямбда у потребителя)
  // не должна перезапускать загрузку — она зависит только от страницы.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const abortRef = useRef<AbortController | null>(null);

  /** Единственная точка загрузки: отменяет предыдущий запрос и ведёт спиннер и ошибку. */
  const load = useCallback(
    async (pageOffset: number, { silent = false }: RefetchOptions = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!silent) {
        setIsRefreshing(true);
        setError(null);
      }

      try {
        // Запрашиваем на один элемент больше, чтобы узнать, есть ли следующая страница.
        const raw = await fetcherRef.current({
          limit: pageSize + 1,
          offset: pageOffset,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        if (raw.length === 0 && pageOffset > 0) {
          // Страница опустела (например, после удаления) — возвращаемся назад,
          // смена offset сама запустит загрузку предыдущей страницы.
          setOffset(Math.max(0, pageOffset - pageSize));
          return;
        }

        setPageState(toPageState(raw, pageSize));
        setError(null);
      } catch (err: unknown) {
        if (controller.signal.aborted || isAbortError(err)) return;
        setError(toUserMessage(err));
      } finally {
        if (!controller.signal.aborted) {
          setIsRefreshing(false);
        }
      }
    },
    [pageSize]
  );

  // Первую страницу уже загрузил сервер — загрузку при монтировании пропускаем.
  const skipInitialLoadRef = useRef(true);

  // Перезагрузка при смене страницы.
  useEffect(() => {
    if (skipInitialLoadRef.current) {
      skipInitialLoadRef.current = false;
      return;
    }
    void load(offset);
  }, [load, offset]);

  // Незавершённый запрос не должен пережить размонтирование.
  useEffect(() => () => abortRef.current?.abort(), []);

  const refetch = useCallback(
    (options?: RefetchOptions) => load(offset, options),
    [load, offset]
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
