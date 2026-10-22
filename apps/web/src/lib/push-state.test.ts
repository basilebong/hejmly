import { describe, expect, test } from "bun:test";
import {
  applicationServerKey,
  isAppleMobile,
  type PushEnvironment,
  pushStateOf,
} from "./push-state.ts";

const capable: PushEnvironment = {
  serviceWorker: true,
  pushManager: true,
  notification: true,
  appleMobile: false,
  standalone: false,
  permission: "default",
};

describe("pushStateOf", () => {
  test("a capable browser can turn notifications on", () => {
    expect(pushStateOf(capable)).toEqual({ kind: "available" });
    expect(pushStateOf({ ...capable, permission: "granted" })).toEqual({ kind: "available" });
  });

  test("iPhone and iPad need the home-screen app first, even when Safari hides PushManager", () => {
    expect(pushStateOf({ ...capable, appleMobile: true, pushManager: false })).toEqual({
      kind: "needs_install",
    });
    expect(pushStateOf({ ...capable, appleMobile: true, standalone: true })).toEqual({
      kind: "available",
    });
  });

  test("an installed app on an iOS older than 16.4 needs a newer iOS, not another browser", () => {
    expect(
      pushStateOf({ ...capable, appleMobile: true, standalone: true, pushManager: false }),
    ).toEqual({ kind: "needs_newer_ios" });
  });

  test("a browser without the APIs is unsupported", () => {
    expect(pushStateOf({ ...capable, pushManager: false })).toEqual({ kind: "unsupported" });
    expect(pushStateOf({ ...capable, serviceWorker: false })).toEqual({ kind: "unsupported" });
  });

  test("a refused permission is reported as blocked", () => {
    expect(pushStateOf({ ...capable, permission: "denied" })).toEqual({ kind: "blocked" });
  });
});

describe("isAppleMobile", () => {
  test("recognises iPhone, and iPadOS which reports itself as a Mac with touch", () => {
    expect(isAppleMobile("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe(true);
    expect(isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isAppleMobile("Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5)).toBe(false);
  });
});

describe("applicationServerKey", () => {
  test("decodes the server's base64url VAPID key into the 65-byte point", () => {
    const raw = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i));
    const encoded = btoa(String.fromCharCode(...raw))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    expect([...applicationServerKey(encoded)]).toEqual([...raw]);
  });
});
