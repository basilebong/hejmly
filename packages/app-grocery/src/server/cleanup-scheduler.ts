import { Bunqueue } from "bunqueue/client";
import type { GroceryItemId } from "../shared/index.ts";
import { isPurchased } from "../shared/index.ts";
import type { GroceryService } from "./service.ts";

export const PURCHASED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const QUEUE_NAME = "grocery-cleanup";
const JOB_NAME = "delete-purchased";

const jobIdFor = (itemId: GroceryItemId): string => `cleanup:${itemId}`;

export type CleanupJobData = { itemId: GroceryItemId };

export type CleanupScheduler = {
  schedule(itemId: GroceryItemId): Promise<void>;
  cancel(itemId: GroceryItemId): Promise<void>;
  close(): Promise<void>;
};

export type CleanupOptions = {
  service: GroceryService;
  dataPath: string;
  ttlMs?: number;
};

export const createCleanupScheduler = (opts: CleanupOptions): CleanupScheduler => {
  const ttl = opts.ttlMs ?? PURCHASED_TTL_MS;

  const bq = new Bunqueue<CleanupJobData>(QUEUE_NAME, {
    embedded: true,
    dataPath: opts.dataPath,
    concurrency: 1,
    processor: async (job) => {
      const result = await opts.service.removeIfPurchased(job.data.itemId);
      if (result.kind === "err" && result.error.kind !== "not_found") {
        throw new Error(`cleanup failed: ${result.error.kind}`);
      }
    },
  });

  const addJob = async (itemId: GroceryItemId, delay: number): Promise<void> => {
    await bq.add(
      JOB_NAME,
      { itemId },
      {
        delay,
        jobId: jobIdFor(itemId),
        removeOnComplete: true,
      },
    );
  };

  const reconcile = async (): Promise<void> => {
    const items = await opts.service.listPurchased();
    const now = Date.now();
    for (const item of items) {
      if (!isPurchased(item.status)) continue;
      const elapsed = now - item.status.purchasedAt;
      const delay = Math.max(0, ttl - elapsed);
      const id = jobIdFor(item.id);
      const existing = await bq.getJob(id);
      if (existing !== null) continue;
      await addJob(item.id, delay).catch((e) =>
        console.error(`cleanup reconcile add ${item.id} failed`, e),
      );
    }
  };

  queueMicrotask(() => {
    reconcile().catch((e) => console.error("cleanup reconcile failed", e));
  });

  return {
    async schedule(itemId) {
      await addJob(itemId, ttl);
    },
    async cancel(itemId) {
      const id = jobIdFor(itemId);
      const job = await bq.getJob(id);
      if (job !== null) {
        await job.remove();
      }
    },
    async close() {
      await bq.close();
    },
  };
};
