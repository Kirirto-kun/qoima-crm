"use client";

import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import type { Paginated } from "./types";

/**
 * DRF page-number pagination as an append-only list: first page on mount,
 * "load more" appends the next page, "load all" keeps fetching until done.
 */
export function usePagedList<T>({
  queryKey,
  fetchPage,
  enabled = true,
}: {
  queryKey: QueryKey;
  fetchPage: (page: number) => Promise<Paginated<T>>;
  enabled?: boolean;
}) {
  const [loadingAll, setLoadingAll] = useState(false);
  const q = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
    enabled,
  });

  const items = useMemo(
    () => q.data?.pages.flatMap((p) => p.results) ?? [],
    [q.data]
  );
  const total = q.data?.pages[0]?.count ?? 0;
  const { hasNextPage, fetchNextPage } = q;

  const loadAll = useCallback(async () => {
    setLoadingAll(true);
    try {
      let result = await fetchNextPage();
      while (result.hasNextPage && !result.isError) {
        result = await fetchNextPage();
      }
    } finally {
      setLoadingAll(false);
    }
  }, [fetchNextPage]);

  return {
    query: q,
    items,
    total,
    hasMore: Boolean(hasNextPage),
    loadMore: () => fetchNextPage(),
    loadAll,
    isLoadingMore: q.isFetchingNextPage || loadingAll,
  };
}
