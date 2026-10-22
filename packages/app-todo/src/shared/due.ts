import * as v from "valibot";

const DAY_MS = 86_400_000;

type Ymd = { y: number; m: number; d: number };

const splitYmd = (raw: string): Ymd => {
  const [y = "", m = "", d = ""] = raw.split("-");
  return { y: Number(y), m: Number(m), d: Number(d) };
};

const utcDay = ({ y, m, d }: Ymd): number => Date.UTC(y, m - 1, d);

const isCalendarDate = (raw: string): boolean => {
  const ymd = splitYmd(raw);
  const at = new Date(utcDay(ymd));
  return (
    at.getUTCFullYear() === ymd.y && at.getUTCMonth() === ymd.m - 1 && at.getUTCDate() === ymd.d
  );
};

export const DueDateSchema = v.pipe(
  v.string(),
  v.isoDate("Use a date like 2026-10-31"),
  v.check(isCalendarDate, "That date doesn't exist"),
  v.brand("DueDate"),
);
export type DueDate = v.InferOutput<typeof DueDateSchema>;

export const parseDueDate = (raw: unknown): DueDate => v.parse(DueDateSchema, raw);

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

const fromUtcDay = (ms: number): DueDate => {
  const at = new Date(ms);
  return parseDueDate(
    `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1, 2)}-${pad(at.getUTCDate(), 2)}`,
  );
};

export const localDueDate = (at: Date): DueDate =>
  parseDueDate(`${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1, 2)}-${pad(at.getDate(), 2)}`);

export const addDays = (date: DueDate, days: number): DueDate =>
  fromUtcDay(utcDay(splitYmd(date)) + days * DAY_MS);

const daysBetween = (from: DueDate, to: DueDate): number =>
  Math.round((utcDay(splitYmd(to)) - utcDay(splitYmd(from))) / DAY_MS);

export type DueState =
  | { kind: "overdue"; days: number }
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "upcoming"; days: number };

export const dueState = (due: DueDate, today: DueDate): DueState => {
  const days = daysBetween(today, due);
  if (days < 0) return { kind: "overdue", days: -days };
  if (days === 0) return { kind: "today" };
  if (days === 1) return { kind: "tomorrow" };
  return { kind: "upcoming", days };
};

export const dueLabel = (due: DueDate, today: DueDate, locale?: string): string => {
  const days = daysBetween(today, due);
  if (days === -1) return "Yesterday";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const at = new Date(utcDay(splitYmd(due)));
  if (days > 1 && days < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(at);
  }
  const sameYear = splitYmd(due).y === splitYmd(today).y;
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(at);
};
