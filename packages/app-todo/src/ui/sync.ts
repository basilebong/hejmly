import { match } from "ts-pattern";
import type { SyncState } from "../shared/index.ts";

export const syncFlags = (state: SyncState): { queued: boolean; failed: boolean } =>
  match(state)
    .with({ kind: "synced" }, () => ({ queued: false, failed: false }))
    .with({ kind: "queued" }, () => ({ queued: true, failed: false }))
    .with({ kind: "error" }, () => ({ queued: false, failed: true }))
    .exhaustive();
