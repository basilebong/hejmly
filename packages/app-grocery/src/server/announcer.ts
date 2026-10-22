import type { PushService } from "@hejmly/core/server";
import { type UserId, UserIdSchema } from "@hejmly/core/shared";
import { Bunqueue } from "bunqueue/client";
import * as v from "valibot";
import type { GroceryItem, GroceryItemId } from "../shared/index.ts";
import { announcementTag, describeAdditions, windowOf } from "./announce.ts";
import type { GroceryService } from "./service.ts";

export const ANNOUNCE_WINDOW_MS = 60_000;
export const ANNOUNCE_GRACE_MS = 5_000;

const QUEUE_NAME = "grocery-announce";
const JOB_NAME = "announce-additions";
const REMEMBERED_WINDOWS = 30;

const AnnounceJobDataSchema = v.object({
  by: UserIdSchema,
  window: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type AnnounceJobData = v.InferOutput<typeof AnnounceJobDataSchema>;

export type GroceryAnnouncer = {
  itemAdded(item: GroceryItem): Promise<void>;
  close(): Promise<void>;
};

export type AnnouncerOptions = {
  service: GroceryService;
  push: Pick<PushService, "notify">;
  dataPath: string;
  windowMs?: number;
  graceMs?: number;
};

const windowKey = (by: UserId, window: number): string => `${by}:${window}`;

export const createGroceryAnnouncer = (opts: AnnouncerOptions): GroceryAnnouncer => {
  const size = opts.windowMs ?? ANNOUNCE_WINDOW_MS;
  const grace = opts.graceMs ?? ANNOUNCE_GRACE_MS;
  const scheduling = new Map<string, Promise<void>>();
  const started = new Map<string, number>();
  const announced = new Map<GroceryItemId, number>();

  const forgetOldWindows = (current: number): void => {
    const oldest = current - REMEMBERED_WINDOWS;
    for (const [key, window] of started) if (window < oldest) started.delete(key);
    for (const [id, window] of announced) if (window < oldest) announced.delete(id);
  };

  const announce = async ({ by, window }: AnnounceJobData): Promise<void> => {
    // Set before listing: an itemAdded that still sees this window as unstarted
    // belongs to an item already inserted, so the listing below includes it.
    started.set(windowKey(by, window), window);
    forgetOldWindows(window);
    const { start, end } = windowOf(window * size, size);
    const added = (await opts.service.list())
      .filter(
        (item) =>
          item.addedBy.kind === "user" &&
          item.addedBy.id === by &&
          item.status.kind === "pending" &&
          item.createdAt >= start &&
          item.createdAt < end &&
          !announced.has(item.id),
      )
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const first = added[0];
    if (first === undefined) return;
    for (const item of added) announced.set(item.id, window);
    const result = await opts.push.notify(
      "grocery_added",
      { except: by },
      {
        title: "Grocery list",
        body: describeAdditions(
          first.addedBy.name,
          added.map((item) => item.name),
        ),
        tag: await announcementTag(by, window),
        url: "/grocery",
      },
    );
    if (result.kind === "err") console.error("grocery announce refused", result.error);
  };

  const bq = new Bunqueue<AnnounceJobData>(QUEUE_NAME, {
    embedded: true,
    dataPath: opts.dataPath,
    concurrency: 1,
    processor: async (job) => {
      const data = v.safeParse(AnnounceJobDataSchema, job.data);
      if (!data.success) {
        console.error("grocery announce: malformed job ignored", { jobId: job.id });
        return;
      }
      await announce(data.output);
    },
  });
  bq.on("error", (error) => {
    console.error("grocery announce worker error", { error: error.name });
  });

  const announceLate = async (by: UserId, window: number, itemId: GroceryItemId) => {
    await bq.add(
      JOB_NAME,
      { by, window },
      { jobId: `announce:${by}:${window}:${itemId}`, removeOnComplete: true },
    );
  };

  const scheduleWindow = async (by: UserId, window: number): Promise<void> => {
    const jobId = `announce:${by}:${window}`;
    if ((await bq.getJob(jobId)) !== null) return;
    const { end } = windowOf(window * size, size);
    await bq.add(
      JOB_NAME,
      { by, window },
      { delay: Math.max(0, end + grace - Date.now()), jobId, removeOnComplete: true },
    );
  };

  const itemAdded = async (item: GroceryItem): Promise<void> => {
    if (item.addedBy.kind !== "user") return;
    const by = item.addedBy.id;
    const { index } = windowOf(item.createdAt, size);
    const key = windowKey(by, index);
    if (started.has(key)) return announceLate(by, index, item.id);
    const pending = scheduling.get(key);
    if (pending !== undefined) return pending;
    const next = scheduleWindow(by, index).finally(() => scheduling.delete(key));
    scheduling.set(key, next);
    return next;
  };

  return {
    itemAdded,
    async close() {
      await bq.close();
    },
  };
};
