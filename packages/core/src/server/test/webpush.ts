import type { PushSubscriptionInput } from "../../shared/index.ts";

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const fromB64url = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

const hkdf = async (
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> => {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
};

export type TestDevice = {
  subscription: (endpoint: string) => PushSubscriptionInput;
  decrypt: (body: Uint8Array) => Promise<string>;
};

export const createTestDevice = async (): Promise<TestDevice> => {
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));

  const decrypt = async (body: Uint8Array): Promise<string> => {
    const salt = body.slice(0, 16);
    const keyIdLength = body[20] ?? 0;
    const asPublic = body.slice(21, 21 + keyIdLength);
    const ciphertext = body.slice(21 + keyIdLength);
    const senderKey = await crypto.subtle.importKey(
      "raw",
      asPublic,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const ecdhSecret = new Uint8Array(
      await crypto.subtle.deriveBits({ name: "ECDH", public: senderKey }, keys.privateKey, 256),
    );
    const ikm = await hkdf(
      authSecret,
      ecdhSecret,
      concat(text("WebPush: info\0"), uaPublic, asPublic),
      32,
    );
    const cek = await hkdf(salt, ikm, concat(text("Content-Encoding: aes128gcm\0")), 16);
    const nonce = await hkdf(salt, ikm, concat(text("Content-Encoding: nonce\0")), 12);
    const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
    const padded = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ciphertext),
    );
    let end = padded.length - 1;
    while (end >= 0 && padded[end] === 0) end -= 1;
    if (padded[end] !== 2) throw new Error("missing RFC 8188 last-record delimiter");
    return new TextDecoder().decode(padded.slice(0, end));
  };

  return {
    subscription: (endpoint) => ({
      endpoint,
      keys: { p256dh: b64url(uaPublic), auth: b64url(authSecret) },
    }),
    decrypt,
  };
};

export type VapidClaims = { aud: string; exp: number; sub: string };

export const verifyVapid = async (authorization: string): Promise<VapidClaims> => {
  const match = /^vapid t=([^,]+), k=(\S+)$/.exec(authorization);
  if (match === null) throw new Error(`not a VAPID header: ${authorization}`);
  const [, jwt = "", k = ""] = match;
  const [header = "", payload = "", signature = ""] = jwt.split(".");
  const key = await crypto.subtle.importKey(
    "raw",
    fromB64url(k),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    fromB64url(signature),
    concat(text(`${header}.${payload}`)),
  );
  if (!valid) throw new Error("VAPID signature does not verify");
  const claims: unknown = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  if (
    typeof claims !== "object" ||
    claims === null ||
    !("aud" in claims) ||
    !("exp" in claims) ||
    !("sub" in claims) ||
    typeof claims.aud !== "string" ||
    typeof claims.exp !== "number" ||
    typeof claims.sub !== "string"
  ) {
    throw new Error("VAPID claims malformed");
  }
  return { aud: claims.aud, exp: claims.exp, sub: claims.sub };
};
