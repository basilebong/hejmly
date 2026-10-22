import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPushService, type Db, type PushRequest } from "@hejmly/core/server";
import { sessions, users } from "@hejmly/core/server/schema";
import { createTestDevice, type TestDevice, withTestAuth } from "@hejmly/core/server/test";
import {
  type PushMessage,
  PushMessageSchema,
  parseSessionId,
  parseUserId,
  type UserId,
} from "@hejmly/core/shared";
import { shutdownManager } from "bunqueue/client";
import * as v from "valibot";
import { parseDueDate } from "../shared/index.ts";
import { createDueReminders, type DueReminders, describeDueTasks } from "./due-reminders.ts";
import { createTodoService, type TodoService } from "./service.ts";

const ANNA = parseUserId("u_anna");
const BASILE = parseUserId("u_basile");
const endpointOf = (who: string) => `https://fcm.googleapis.com/fcm/send/${who}`;

type Ctx = {
  db: Db;
  todo: TodoService;
  reminders: DueReminders;
  sent: PushRequest[];
  phones: Record<"anna" | "basile", TestDevice>;
  add: (title: string, dueOn: string | null, assignee: UserId | null) => Promise<void>;
  inbox: (who: "anna" | "basile") => Promise<PushMessage[]>;
};

const seed = async (db: Db): Promise<void> => {
  const now = new Date();
  await db.insert(users).values([
    { id: ANNA, name: "Anna", email: "anna@example.com", createdAt: now, updatedAt: now },
    { id: BASILE, name: "Basile", email: "basile@example.com", createdAt: now, updatedAt: now },
  ]);
  await db.insert(sessions).values(
    [ANNA, BASILE].map((user) => ({
      id: `s_${user}`,
      token: `token-${user}`,
      userId: user,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    })),
  );
};

const withReminders = async (timeZone: string, fn: (ctx: Ctx) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "hejmly-due-"));
  try {
    await withTestAuth({}, async ({ db }) => {
      await seed(db);
      const sent: PushRequest[] = [];
      const push = createPushService(db, {
        isMember: () => true,
        subject: "https://hejmly.example",
        send: async (req) => {
          sent.push(req);
          return { status: 201 };
        },
      });
      const phones = { anna: await createTestDevice(), basile: await createTestDevice() };
      for (const [who, id] of [
        ["anna", ANNA],
        ["basile", BASILE],
      ] as const) {
        await push.subscribe(
          { userId: id, sessionId: parseSessionId(`s_${id}`) },
          phones[who].subscription(endpointOf(who)),
        );
      }
      const todo = createTodoService(db, { isMember: () => true });
      const project = await todo.createProject({ name: "House" }, ANNA);
      if (project.kind === "err") throw new Error("project not created");
      const reminders = createDueReminders({
        service: todo,
        push,
        timeZone,
        dataPath: join(dir, "jobs.db"),
      });
      const add = async (title: string, dueOn: string | null, assignee: UserId | null) => {
        const created = await todo.createTask(
          project.value.id,
          {
            title,
            ...(dueOn === null ? {} : { dueOn: parseDueDate(dueOn) }),
            ...(assignee === null ? {} : { assigneeId: assignee }),
          },
          ANNA,
        );
        if (created.kind === "err") throw new Error(`task ${title} not created`);
      };
      const inbox = (who: "anna" | "basile") =>
        Promise.all(
          sent
            .filter((r) => r.endpoint === endpointOf(who))
            .map(async (r) =>
              v.parse(PushMessageSchema, JSON.parse(await phones[who].decrypt(r.body))),
            ),
        );
      try {
        await fn({ db, todo, reminders, sent, phones, add, inbox });
      } finally {
        await reminders.close();
        shutdownManager();
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("describeDueTasks", () => {
  test("counts what is due and lists up to three titles", () => {
    expect(describeDueTasks(["Pay rent"], 0)).toEqual({
      title: "1 task due today",
      body: "Pay rent",
    });
    expect(describeDueTasks(["Pay rent", "Call plumber"], 1)).toEqual({
      title: "2 tasks due, 1 overdue",
      body: "Pay rent and Call plumber",
    });
    expect(describeDueTasks(["A", "B", "C", "D", "E"], 0)).toEqual({
      title: "5 tasks due today",
      body: "A, B, C and 2 more",
    });
  });

  test("keeps a long title within the notification limit", () => {
    const { body } = describeDueTasks(["x".repeat(600)], 0);
    expect(body.length).toBeLessThanOrEqual(400);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("due reminders", () => {
  test("in the morning, each assignee gets one notification listing their due and overdue tasks", async () => {
    await withReminders("Europe/Berlin", async (ctx) => {
      await ctx.add("Water plants", "2026-10-22", ANNA);
      await ctx.add("Pay rent", "2026-10-20", ANNA);
      await ctx.add("Next week", "2026-10-29", ANNA);
      await ctx.add("Fix bike", "2026-10-22", BASILE);
      await ctx.add("Nobody's", "2026-10-22", null);

      expect(await ctx.reminders.runAt(new Date("2026-10-22T06:05:00Z"))).toEqual({
        reminded: 2,
      });
      expect(await ctx.inbox("anna")).toEqual([
        {
          title: "2 tasks due, 1 overdue",
          body: "Pay rent and Water plants",
          tag: "todo-due-2026-10-22",
          url: "/todo",
        },
      ]);
      expect(await ctx.inbox("basile")).toEqual([
        { title: "1 task due today", body: "Fix bike", tag: "todo-due-2026-10-22", url: "/todo" },
      ]);
    });
  });

  test("waits for the morning in the household's time zone", async () => {
    await withReminders("Europe/Berlin", async (ctx) => {
      await ctx.add("Water plants", "2026-10-22", ANNA);
      expect(await ctx.reminders.runAt(new Date("2026-10-22T05:30:00Z"))).toEqual({
        reminded: 0,
      });
      expect(ctx.sent).toEqual([]);
    });
  });

  test("reminds once a day, however often it runs, and again the next day", async () => {
    await withReminders("UTC", async (ctx) => {
      await ctx.add("Water plants", "2026-10-22", ANNA);
      await ctx.reminders.runAt(new Date("2026-10-22T08:00:00Z"));
      await ctx.reminders.runAt(new Date("2026-10-22T08:15:00Z"));
      await ctx.reminders.runAt(new Date("2026-10-22T21:00:00Z"));
      expect(await ctx.inbox("anna")).toHaveLength(1);
      await ctx.reminders.runAt(new Date("2026-10-23T08:00:00Z"));
      expect((await ctx.inbox("anna")).map((m) => m.title)).toEqual([
        "1 task due today",
        "1 task due, 1 overdue",
      ]);
    });
  });

  test("a task done before the morning is not mentioned, and nobody with nothing due is notified", async () => {
    await withReminders("UTC", async (ctx) => {
      await ctx.add("Water plants", "2026-10-22", ANNA);
      const tasks = await ctx.todo.listDueByAssignee(parseDueDate("2026-10-22"));
      const task = tasks[0]?.tasks[0];
      if (task === undefined) throw new Error("no task");
      await ctx.todo.completeTask(task.id, ANNA);
      expect(await ctx.reminders.runAt(new Date("2026-10-22T08:00:00Z"))).toEqual({
        reminded: 0,
      });
      expect(ctx.sent).toEqual([]);
    });
  });

  test("respects the person's choice to turn task reminders off", async () => {
    await withReminders("UTC", async (ctx) => {
      await ctx.add("Water plants", "2026-10-22", ANNA);
      const push = createPushService(ctx.db, {
        isMember: () => true,
        subject: "https://hejmly.example",
        send: async () => ({ status: 201 }),
      });
      await push.updatePreferences(ANNA, { todo_due: false });
      await ctx.reminders.runAt(new Date("2026-10-22T08:00:00Z"));
      expect(ctx.sent).toEqual([]);
    });
  });

  test("a failed send is retried on the next run that day", async () => {
    await withTestAuth({}, async ({ db }) => {
      await seed(db);
      const todo = createTodoService(db, { isMember: () => true });
      const project = await todo.createProject({ name: "House" }, ANNA);
      if (project.kind === "err") throw new Error("project not created");
      await todo.createTask(
        project.value.id,
        { title: "Water plants", dueOn: parseDueDate("2026-10-22"), assigneeId: ANNA },
        ANNA,
      );
      const outcomes: ("unavailable" | "ok")[] = ["unavailable", "ok"];
      const calls: UserId[] = [];
      const dir = mkdtempSync(join(tmpdir(), "hejmly-due-"));
      const reminders = createDueReminders({
        service: todo,
        push: {
          notify: async (_topic, audience) => {
            if (audience.only !== undefined) calls.push(audience.only);
            return outcomes.shift() === "unavailable"
              ? { kind: "err", error: { kind: "unavailable" } }
              : { kind: "ok", value: { sent: 1, removed: 0, failed: 0 } };
          },
        },
        timeZone: "UTC",
        dataPath: join(dir, "jobs.db"),
      });
      try {
        expect(await reminders.runAt(new Date("2026-10-22T08:00:00Z"))).toEqual({ reminded: 0 });
        expect(await reminders.runAt(new Date("2026-10-22T08:15:00Z"))).toEqual({ reminded: 1 });
        expect(await reminders.runAt(new Date("2026-10-22T08:30:00Z"))).toEqual({ reminded: 0 });
        expect(calls).toEqual([ANNA, ANNA]);
      } finally {
        await reminders.close();
        shutdownManager();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  test("the schedule runs the check by itself", async () => {
    await withTestAuth({}, async ({ db }) => {
      await seed(db);
      const todo = createTodoService(db, { isMember: () => true });
      const project = await todo.createProject({ name: "House" }, ANNA);
      if (project.kind === "err") throw new Error("project not created");
      const today = new Date().toISOString().slice(0, 10);
      await todo.createTask(
        project.value.id,
        { title: "Water plants", dueOn: parseDueDate(today), assigneeId: ANNA },
        ANNA,
      );
      const calls: UserId[] = [];
      const dir = mkdtempSync(join(tmpdir(), "hejmly-due-"));
      const reminders = createDueReminders({
        service: todo,
        push: {
          notify: async (_topic, audience) => {
            if (audience.only !== undefined) calls.push(audience.only);
            return { kind: "ok", value: { sent: 1, removed: 0, failed: 0 } };
          },
        },
        timeZone: "UTC",
        dataPath: join(dir, "jobs.db"),
        hour: 0,
        checkEveryMs: 200,
      });
      try {
        const deadline = Date.now() + 5000;
        while (calls.length === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
        expect(calls).toEqual([ANNA]);
      } finally {
        await reminders.close();
        shutdownManager();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
