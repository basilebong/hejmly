import * as v from "valibot";
import { splitEmailList } from "../../shared/index.ts";

const emailSchema = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email());

export const parseAllowedEmails = (raw: string | undefined): ReadonlySet<string> => {
  if (raw === undefined) return new Set();
  return new Set(splitEmailList(raw).map((s) => v.parse(emailSchema, s)));
};

const normalize = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
};

export const isAllowedEmail = (allowed: ReadonlySet<string>, email: unknown): boolean => {
  const normalized = normalize(email);
  if (normalized === null) return false;
  return allowed.has(normalized);
};
