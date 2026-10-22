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
