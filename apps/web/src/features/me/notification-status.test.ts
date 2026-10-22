import { describe, expect, test } from "bun:test";
import {
  type DeviceView,
  deviceHint,
  deviceViewOf,
  failureMessage,
  isDeviceSwitchUsable,
} from "./notification-status.ts";

const idle = { busy: null, notice: null } as const;

describe("deviceViewOf", () => {
  test("follows the device query while nothing is in flight", () => {
    expect(deviceViewOf({ ...idle, query: { kind: "pending" } })).toEqual({ kind: "checking" });
    expect(deviceViewOf({ ...idle, query: { kind: "error", retrying: false } })).toEqual({
      kind: "check_failed",
      retrying: false,
    });
    expect(deviceViewOf({ ...idle, query: { kind: "ready", status: { kind: "on" } } })).toEqual({
      kind: "on",
    });
    expect(
      deviceViewOf({ ...idle, query: { kind: "ready", status: { kind: "no_worker" } } }),
    ).toEqual({ kind: "no_worker" });
  });

  test("a change in flight wins over what the query last said", () => {
    const off = { kind: "ready", status: { kind: "off" } } as const;
    expect(deviceViewOf({ ...idle, busy: "on", query: off })).toEqual({ kind: "turning_on" });
    expect(
      deviceViewOf({ ...idle, busy: "off", query: { kind: "error", retrying: false } }),
    ).toEqual({
      kind: "turning_off",
    });
  });

  test("remembers why the last turn-on failed, until the device is on", () => {
    const off = { kind: "ready", status: { kind: "off" } } as const;
    expect(deviceViewOf({ ...idle, notice: "declined", query: off })).toEqual({
      kind: "declined",
    });
    expect(deviceViewOf({ ...idle, notice: "browser_failed", query: off })).toEqual({
      kind: "browser_failed",
    });
    expect(
      deviceViewOf({
        ...idle,
        notice: "declined",
        query: { kind: "ready", status: { kind: "on" } },
      }),
    ).toEqual({ kind: "on" });
  });
});

describe("deviceHint", () => {
  const available = { kind: "available" } as const;

  test("a failed check offers a retry and never tells the person to reload", () => {
    const hint = deviceHint(available, { kind: "check_failed", retrying: false });
    expect(hint.action).toEqual({ kind: "retry", pending: false });
    expect(hint.text).not.toMatch(/reload/i);
  });

  test("a retry in flight keeps the same action, marked pending, so focus has somewhere to stay", () => {
    expect(deviceHint(available, { kind: "check_failed", retrying: true }).action).toEqual({
      kind: "retry",
      pending: true,
    });
  });

  test("a device without a service worker yet offers a reload button", () => {
    expect(deviceHint(available, { kind: "no_worker" }).action).toEqual({
      kind: "reload",
      pending: false,
    });
  });

  test("says what is happening while a change is in flight", () => {
    expect(deviceHint(available, { kind: "turning_on" }).text).toBe("Turning on…");
    expect(deviceHint(available, { kind: "turning_off" }).text).toBe("Turning off…");
  });

  test("the on state does not promise a second prompt", () => {
    expect(deviceHint(available, { kind: "on" }).text).not.toMatch(/ask/i);
  });

  test("after a refused prompt, explains how to try again", () => {
    expect(deviceHint(available, { kind: "declined" }).text).toMatch(/try again/i);
  });

  test("a browser that could not subscribe keeps saying so after the toast is gone", () => {
    const text = deviceHint(available, { kind: "browser_failed" }).text;
    expect(text).toMatch(/couldn't set up/i);
    expect(text).not.toMatch(/another browser/i);
  });

  test("the environment wins over the device view", () => {
    const view: DeviceView = { kind: "off" };
    expect(deviceHint({ kind: "needs_install" }, view).text).toMatch(/iOS 16\.4/);
    expect(deviceHint({ kind: "unsupported" }, view).text).toMatch(/Try Chrome/);
    expect(deviceHint({ kind: "needs_newer_ios" }, view).text).toMatch(/iOS 16\.4/);
    expect(deviceHint({ kind: "needs_newer_ios" }, view).text).not.toMatch(/Chrome/);
    expect(deviceHint({ kind: "blocked" }, view).text).toMatch(/blocked/);
    expect(deviceHint({ kind: "blocked" }, view).action).toBeUndefined();
  });
});

describe("isDeviceSwitchUsable", () => {
  test("only settled on/off states can be toggled", () => {
    const usable = (["on", "off", "declined", "browser_failed"] as const).map((kind) =>
      isDeviceSwitchUsable({ kind: "available" }, { kind }),
    );
    expect(usable).toEqual([true, true, true, true]);
    for (const kind of ["checking", "no_worker"] as const) {
      expect(isDeviceSwitchUsable({ kind: "available" }, { kind })).toBe(false);
    }
    expect(
      isDeviceSwitchUsable({ kind: "available" }, { kind: "check_failed", retrying: false }),
    ).toBe(false);
    expect(isDeviceSwitchUsable({ kind: "blocked" }, { kind: "off" })).toBe(false);
  });
});

describe("failureMessage", () => {
  test("each failure says why", () => {
    const messages = [
      failureMessage({ kind: "offline" }),
      failureMessage({ kind: "server" }),
      failureMessage({ kind: "browser" }),
      failureMessage({ kind: "too_many_devices" }),
    ];
    expect(new Set(messages).size).toBe(4);
    expect(failureMessage({ kind: "offline" })).toMatch(/offline/i);
  });
});
