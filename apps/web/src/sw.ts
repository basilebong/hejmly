/// <reference lib="webworker" />
import { PushMessageSchema } from "@hejmly/core/shared";
import * as v from "valibot";
import { Queue } from "workbox-background-sync";
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  type PrecacheEntry,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import type { OpenUrlMessage } from "./lib/sw-messages.ts";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (PrecacheEntry | string)[];
};

const MUTATION_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

void self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api/, /^\/mcp/, /^\/\.well-known/, /^\/healthz/],
  }),
);

for (const method of MUTATION_METHODS) {
  const queue = new Queue(`Hejmly-mutations-${method.toLowerCase()}`, {
    maxRetentionTime: 24 * 60,
  });
  registerRoute(
    ({ url, sameOrigin }) =>
      sameOrigin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/push/"),
    async ({ request }) => {
      const original = request.clone();
      try {
        return await fetch(request);
      } catch (error) {
        await queue.pushRequest({ request: original });
        throw error;
      }
    },
    method,
  );
}

const ICON = "/icons/icon-192.png";

const readMessage = (event: PushEvent): v.InferOutput<typeof PushMessageSchema> | null => {
  try {
    const parsed = v.safeParse(PushMessageSchema, event.data?.json());
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
};

self.addEventListener("push", (event) => {
  const message = readMessage(event);
  const shown =
    message === null
      ? self.registration.showNotification("Hejmly", { body: "Something changed.", icon: ICON })
      : self.registration.showNotification(message.title, {
          body: message.body,
          tag: message.tag,
          icon: ICON,
          data: { url: message.url },
        });
  event.waitUntil(shown);
});

const ClickDataSchema = v.object({ url: PushMessageSchema.entries.url });

const openApp = async (path: string): Promise<void> => {
  const target = new URL(path, self.location.origin).href;
  const controlled = await self.clients.matchAll({ type: "window" });
  const own = controlled.find((client) => new URL(client.url).origin === self.location.origin);
  if (own !== undefined) {
    await own.focus();
    await own.navigate(target);
    return;
  }
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const uncontrolled = all.find((client) => new URL(client.url).origin === self.location.origin);
  if (uncontrolled !== undefined) {
    const message: OpenUrlMessage = { kind: "open_url", url: path };
    uncontrolled.postMessage(message);
    await uncontrolled.focus();
    return;
  }
  await self.clients.openWindow(target);
};

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = v.safeParse(ClickDataSchema, event.notification.data);
  event.waitUntil(openApp(data.success ? data.output.url : "/"));
});
