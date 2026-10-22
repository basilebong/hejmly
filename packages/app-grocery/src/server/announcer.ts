import type { PushService } from "@hejmly/core/server";
import type { UserId } from "@hejmly/core/shared";
import { Bunqueue } from "bunqueue/client";
import type { GroceryItem } from "../shared/index.ts";
import { describeAdditions, windowOf } from "./announce.ts";
import type { GroceryService } from "./service.ts";

export const ANNOUNCE_WINDOW_MS = 60_000;

const QUEUE_NAME = "grocery-announce";
const JOB_NAME = "announce-additions";

export type AnnounceJobData = { by: UserId; window: number };

export type GroceryAnnouncer = {
  itemAdded(item: GroceryItem): Promise<void>;
  close(): Promise<void>;
};

export type AnnouncerOptions = {
  service: GroceryService;
  push: Pick<PushService, "notify">;
  dataPath: string;
  windowMs?: number;
};

export const createGroceryAnnouncer = (opts: AnnouncerOptions): GroceryAnnouncer => {
  const size = opts.windowMs ?? ANNOUNCE_WINDOW_MS;
  const scheduling = new Map<string, Promise<void>>();

  const bq = new Bunqueue<AnnounceJobData>(QUEUE_NAME, {
    embedded: true,
    dataPath: opts.dataPath,
    concurrency: 1,
    processor: async (job) => {
      const { by, window } = job.data;
      const start = window * size;
      const end = start + size;
      const added = (await opts.service.list())
        .filter(
          (item) =>
            item.addedBy.kind === "user" &&
            item.addedBy.id === by &&
            item.status.kind === "pending" &&
            item.createdAt >= start &&
            item.createdAt < end,
        )
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      const first = added[0];
      if (first === undefined) return;
      await opts.push.notify(
        "grocery_added",
        { except: by },
        {
          title: "Grocery list",
          body: describeAdditions(
            first.addedBy.name,
            added.map((item) => item.name),
          ),
          tag: "grocery-added",
          url: "/grocery",
        },
      );
    },
  });

  const schedule = async (by: UserId, at: number): Promise<void> => {
    const { index, end } = windowOf(at, size);
    const jobId = `announce:${by}:${index}`;
    if ((await bq.getJob(jobId)) !== null) return;
    await bq.add(
      JOB_NAME,
      { by, window: index },
      { delay: Math.max(0, end - Date.now()), jobId, removeOnComplete: true },
    );
  };

  return {
    async itemAdded(item) {
      if (item.addedBy.kind !== "user") return;
      const by = item.addedBy.id;
      const key = `${by}:${windowOf(item.createdAt, size).index}`;
      const pending = scheduling.get(key);
      if (pending !== undefined) return pending;
      const next = schedule(by, item.createdAt).finally(() => scheduling.delete(key));
      scheduling.set(key, next);
      return next;
    },
    async close() {
      await bq.close();
    },
  };
};
