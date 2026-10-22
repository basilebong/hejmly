import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as v from "valibot";

import { Toaster } from "@/components/ui/sonner";
import { QUERY_CACHE_PERSIST_KEY, queryClient } from "@/lib/query-client";
import { OpenUrlMessageSchema } from "@/lib/sw-messages";
import { router } from "@/router";

import "@/styles.css";

const mount = document.getElementById("root");
if (mount === null) throw new Error("Missing #root element in index.html");

const persister = createAsyncStoragePersister({
  storage: window.localStorage,
  key: QUERY_CACHE_PERSIST_KEY,
  throttleTime: 1000,
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const message = v.safeParse(OpenUrlMessageSchema, event.data);
    if (message.success) void router.navigate({ href: message.output.url });
  });
}

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

createRoot(mount).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: ONE_DAY_MS,
        buster: __PERSIST_BUSTER__,
        dehydrateOptions: {
          shouldDehydrateMutation: () => false,
          shouldDehydrateQuery: (query) =>
            query.meta?.persist !== false && defaultShouldDehydrateQuery(query),
        },
      }}
    >
      <RouterProvider router={router} />
      <Toaster richColors closeButton />
    </PersistQueryClientProvider>
  </StrictMode>,
);
