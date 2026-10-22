const EXACT_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);

const HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

const hasEmptyLabel = (host: string): boolean => host.split(".").some((label) => label === "");

export const normalizePushEndpoint = (raw: string): string | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
    return null;
  }
  const host = url.hostname;
  if (hasEmptyLabel(host)) return null;
  const allowed = EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  return allowed ? url.href : null;
};
