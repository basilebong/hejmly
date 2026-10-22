import type { PushService } from "@hejmly/core/server";
import { Bunqueue } from "bunqueue/client";
import { clockInZone, type DueDate, dueState } from "../shared/index.ts";
import type { TodoService } from "./service.ts";

export const REMINDER_HOUR = 8;
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
  checkEveryMs?: number;
};

export type DueReminders = {
  runAt(now: Date): Promise<{ reminded: number }>;
  close(): Promise<void>;
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export const describeDueTasks = (
  titles: readonly string[],
  overdue: number,
): { title: string; body: string } => {
  const title =
    overdue === 0
      ? `${plural(titles.length, "task")} due today`
      : `${plural(titles.length, "task")} due, ${overdue} overdue`;
  const shown = titles.slice(0, NAMED);
  const rest = titles.length - shown.length;
  const last = rest > 0 ? `${rest} more` : shown.pop();
  const list = shown.length === 0 ? (last ?? "") : `${shown.join(", ")} and ${last ?? ""}`;
  const body = list.length <= BODY_MAX ? list : `${list.slice(0, BODY_MAX - 1)}…`;
  return { title, body };
};

export const createDueReminders = (opts: DueRemindersOptions): DueReminders => {
  const hour = opts.hour ?? REMINDER_HOUR;

  const remind = async (today: DueDate): Promise<number> => {
    let reminded = 0;
    for (const { assignee, tasks } of await opts.service.listDueByAssignee(today)) {
      if (!(await opts.service.claimDueReminder(assignee.id, today))) continue;
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
      if (result.kind === "err") {
        await opts.service.releaseDueReminder(assignee.id, today);
        console.error("todo reminders: notify refused", result.error);
        continue;
      }
      reminded += 1;
    }
    return reminded;
  };

  const runAt = async (now: Date): Promise<{ reminded: number }> => {
    const clock = clockInZone(now, opts.timeZone);
    if (clock.hour < hour) return { reminded: 0 };
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
  void bq.every(SCHEDULE_ID, opts.checkEveryMs ?? REMINDER_CHECK_MS, {}).catch((error: unknown) => {
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
