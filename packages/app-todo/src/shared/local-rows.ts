export const LOCAL_ID_PREFIX = "tmp_";

export const isLocalId = (id: string): boolean => id.startsWith(LOCAL_ID_PREFIX);

export const localIdSeed = (): string => `${LOCAL_ID_PREFIX}${crypto.randomUUID()}`;

export type SyncState = { kind: "synced" } | { kind: "queued" } | { kind: "error" };

export type LocalRowState = Exclude<SyncState, { kind: "synced" }>;

const SYNCED: SyncState = { kind: "synced" };
const QUEUED: LocalRowState = { kind: "queued" };
const FAILED: LocalRowState = { kind: "error" };

export type LocalCreateAttempt = {
  localId: string | null;
  status: "idle" | "pending" | "success" | "error";
  submittedAt: number;
};

type Placement = "start" | "end";

export const mergeServerRows = <T extends { id: string }>(
  server: readonly T[],
  cached: readonly T[] | undefined,
  opts: { localAt: Placement; hidden: ReadonlySet<string> },
): T[] => {
  const local = (cached ?? []).filter((r) => isLocalId(r.id));
  const visible = server.filter((r) => !opts.hidden.has(r.id));
  return opts.localAt === "start" ? [...local, ...visible] : [...visible, ...local];
};

export const settleLocalRow = <T extends { id: string }>(
  rows: readonly T[],
  localId: string,
  saved: T,
  newAt: Placement,
): T[] => {
  if (rows.some((r) => r.id === saved.id)) {
    return rows.filter((r) => r.id !== localId).map((r) => (r.id === saved.id ? saved : r));
  }
  if (rows.some((r) => r.id === localId)) {
    return rows.map((r) => (r.id === localId ? saved : r));
  }
  return newAt === "start" ? [saved, ...rows] : [...rows, saved];
};

export const localRowStates = (
  attempts: readonly LocalCreateAttempt[],
): ReadonlyMap<string, LocalRowState> => {
  const latest = new Map<string, LocalCreateAttempt>();
  for (const a of attempts) {
    if (a.localId === null) continue;
    const seen = latest.get(a.localId);
    if (seen === undefined || a.submittedAt >= seen.submittedAt) latest.set(a.localId, a);
  }
  const states = new Map<string, LocalRowState>();
  for (const [id, a] of latest) {
    if (a.status === "error") states.set(id, FAILED);
    else if (a.status !== "success") states.set(id, QUEUED);
  }
  return states;
};

export const syncStateOf = (id: string, states: ReadonlyMap<string, LocalRowState>): SyncState =>
  isLocalId(id) ? (states.get(id) ?? FAILED) : SYNCED;
