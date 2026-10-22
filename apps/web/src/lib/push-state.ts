export type PushEnvironment = {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  appleMobile: boolean;
  standalone: boolean;
  permission: NotificationPermission | "unavailable";
};

export type PushState =
  | { kind: "available" }
  | { kind: "needs_install" }
  | { kind: "unsupported" }
  | { kind: "blocked" };

export const pushStateOf = (env: PushEnvironment): PushState => {
  if (env.appleMobile && !env.standalone) return { kind: "needs_install" };
  if (!env.serviceWorker || !env.pushManager || !env.notification) return { kind: "unsupported" };
  if (env.permission === "denied") return { kind: "blocked" };
  return { kind: "available" };
};

export const isAppleMobile = (userAgent: string, maxTouchPoints: number): boolean =>
  /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

export const applicationServerKey = (base64url: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(base64url.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );

export const readPushEnvironment = (): PushEnvironment => {
  const notification = typeof Notification !== "undefined";
  const standaloneNavigator: unknown = Reflect.get(navigator, "standalone");
  return {
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification,
    appleMobile: isAppleMobile(navigator.userAgent, navigator.maxTouchPoints),
    standalone:
      window.matchMedia("(display-mode: standalone)").matches || standaloneNavigator === true,
    permission: notification ? Notification.permission : "unavailable",
  };
};
