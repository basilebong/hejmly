import type { UserId } from "@hejmly/core/shared";

const BODY_MAX = 400;
const NAMED = 3;

export const describeAdditions = (who: string, names: readonly string[]): string => {
  const shown = names.slice(0, NAMED);
  const rest = names.length - shown.length;
  const last = rest > 0 ? `${rest} more` : shown.pop();
  const list = shown.length === 0 ? (last ?? "") : `${shown.join(", ")} and ${last ?? ""}`;
  const body = `${who} added ${list}`;
  return body.length <= BODY_MAX ? body : `${body.slice(0, BODY_MAX - 1)}…`;
};

export type Window = { index: number; start: number; end: number };

export const windowOf = (at: number, size: number): Window => {
  const index = Math.floor(at / size);
  return { index, start: index * size, end: (index + 1) * size };
};

const TAG_HASH_LENGTH = 10;

export const announcementTag = async (
  by: UserId,
  windowIndex: number,
  sequence = 0,
): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(by)),
  );
  const hash = btoa(String.fromCharCode(...digest))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .slice(0, TAG_HASH_LENGTH);
  const base = `grocery-${hash}-${windowIndex.toString(36)}`;
  return sequence === 0 ? base : `${base}-${sequence.toString(36)}`;
};
