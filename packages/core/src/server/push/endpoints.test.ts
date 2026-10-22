import { describe, expect, test } from "bun:test";
import { isAllowedPushEndpoint } from "./endpoints.ts";

describe("isAllowedPushEndpoint", () => {
  test("allows the browsers' push services over https", () => {
    for (const url of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QGx",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect({ url, allowed: isAllowedPushEndpoint(url) }).toEqual({ url, allowed: true });
    }
  });

  test("refuses anything else, so a member cannot make the server call internal hosts", () => {
    for (const url of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://user:pass@fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilfcm.googleapis.com/x",
      "https://localhost/push",
      "https://127.0.0.1/push",
      "https://169.254.169.254/latest/meta-data",
      "https://notify.windows.com.evil.example/x",
      "not a url",
    ]) {
      expect({ url, allowed: isAllowedPushEndpoint(url) }).toEqual({ url, allowed: false });
    }
  });
});
