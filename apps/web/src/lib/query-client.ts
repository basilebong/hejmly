import { QueryClient } from "@tanstack/react-query";

export const QUERY_CACHE_PERSIST_KEY = "Hejmly-query-cache";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

type HejmlyQueryMeta = { persist?: boolean };

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: HejmlyQueryMeta;
  }
}
