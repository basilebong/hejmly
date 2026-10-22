import type { PushService } from "@hejmly/core/server";
import { Bunqueue } from "bunqueue/client";
import { clockInZone, type DueDate, dueState } from "../shared/index.ts";
import type { TodoService } from "./service.ts";

export const REMINDER_HOUR = 8;
export const REMINDER_LAST_HOUR = 11;
export const REMINDER_CHECK_MS = 15 * 60 * 1000;

const QUEUE_NAME = "todo-due-reminders";
const SCHEDULE_ID = "todo-due-reminders";
const BODY_MAX = 400;
const NAMED = 3;

export type DueRemindersOptions = {
  service: TodoService;
  push: Pick<PushService, "notify">;
  timeZone: string;
  dataPath: string;
  hour?: number;
  lastHour?: number;
  checkEveryMs?: number;
};

export type DueReminders = {
  runAt(now: Date): Promise<{ reminded: number }>;
  close(): Promise<void>;
};

const TITLE_MAX = 40;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const shorten = (text: string, max: number): string => {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
};

const headline = (total: number, overdue: number): string => {
  const today = total - overdue;
  if (overdue === 0) return `${plural(today, "task")} due today`;
  if (today === 0) return `${overdue} overdue ${overdue === 1 ? "task" : "tasks"}`;
  return `${today} due today, ${overdue} overdue`;
};

export const describeDueTasks = (
  titles: readonly string[],
  overdue: number,
): { title: string; body: string } => {
  const shown = titles.slice(0, NAMED).map((title) => shorten(title, TITLE_MAX));
  const rest = titles.length - shown.length;
  const last = rest > 0 ? `${rest} more` : shown.pop();
  const list = shown.length === 0 ? (last ?? "") : `${shown.join(", ")} and ${last ?? ""}`;
  return { title: headline(titles.length, overdue), body: shorten(list, BODY_MAX) };
};

export const createDueReminders = (opts: DueRemindersOptions): DueReminders => {
  const hour = opts.hour ?? REMINDER_HOUR;
  const lastHour = opts.lastHour ?? REMINDER_LAST_HOUR;

  const remind = async (today: DueDate): Promise<number> => {
    let reminded = 0;
    for (const { assignee, tasks } of await opts.service.listDueByAssignee(today)) {
      const claim = await opts.service.claimDueReminder(assignee.id, today);
      if (claim.kind === "err" || !claim.value.claimed) continue;
      const overdue = tasks.filter(
        (task) => task.dueOn !== null && dueState(task.dueOn, today).kind === "overdue",
      ).length;
      const result = await opts.push.notify(
        "todo_due",
        { only: assignee.id },
        {
          ...describeDueTasks(
            tasks.map((task) => task.title),
            overdue,
          ),
          tag: `todo-due-${today}`,
          url: "/todo",
        },
      );
      const undelivered =
        result.kind === "err" || (result.value.sent === 0 && result.value.failed > 0);
      if (undelivered) {
        await opts.service.releaseDueReminder(assignee.id, today);
        console.error("todo reminders: not delivered, will retry", {
          error: result.kind === "err" ? result.error.kind : "delivery_failed",
        });
        continue;
      }
      reminded += 1;
    }
    return reminded;
  };

  const runAt = async (now: Date): Promise<{ reminded: number }> => {
    const clock = clockInZone(now, opts.timeZone);
    if (clock.hour < hour || clock.hour > lastHour) return { reminded: 0 };
    return { reminded: await remind(clock.date) };
  };

  const bq = new Bunqueue<Record<string, never>>(QUEUE_NAME, {
    embedded: true,
    dataPath: opts.dataPath,
    concurrency: 1,
    processor: async () => {
      await runAt(new Date());
    },
  });
  bq.on("error", (error) => {
    console.error("todo reminders worker error", { error: error.name });
  });
  void bq
    .every(
      SCHEDULE_ID,
      opts.checkEveryMs ?? REMINDER_CHECK_MS,
      {},
      {
        jobOpts: { removeOnComplete: true },
      },
    )
    .catch((error: unknown) => {
      console.error("todo reminders: could not schedule", {
        error: error instanceof Error ? error.name : typeof error,
      });
    });

  return {
    runAt,
    async close() {
      await bq.close();
    },
  };
};
