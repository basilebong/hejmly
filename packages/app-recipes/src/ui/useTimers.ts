import { useSyncExternalStore } from "react";
import { cancelTimer, isDone, startTimer, type TimerMap } from "../shared/index.ts";
import { playChime, unlockAudio } from "./chime.ts";

export type UseTimers = {
  timers: TimerMap;
  now: number;
  start: (id: string, label: string, minutes: number) => void;
  cancel: (id: string) => void;
};

const TICK_MS = 500;
const CHIME_REPEAT_MS = 3000;

type Snapshot = { timers: TimerMap; now: number };

let timers: TimerMap = {};
let now = Date.now();
let snapshot: Snapshot = { timers, now };
let interval: ReturnType<typeof setInterval> | null = null;
let sinceChime = 0;
let prevDoneSig = "";
const listeners = new Set<() => void>();

const emit = (): void => {
  snapshot = { timers, now };
  for (const listener of listeners) listener();
};

const tick = (): void => {
  const at = Date.now();
  const entries = Object.entries(timers);
  const anyRunning = entries.some(([, timer]) => !isDone(timer, at));
  const doneSig = entries
    .filter(([, timer]) => isDone(timer, at))
    .map(([id]) => id)
    .join(",");
  if (doneSig.length > 0) {
    if (sinceChime === 0) playChime();
    sinceChime = sinceChime + TICK_MS >= CHIME_REPEAT_MS ? 0 : sinceChime + TICK_MS;
  } else {
    sinceChime = 0;
  }
  if (anyRunning || doneSig !== prevDoneSig) {
    now = at;
    emit();
  }
  prevDoneSig = doneSig;
};

const ensureTicking = (): void => {
  if (interval === null && Object.keys(timers).length > 0) {
    interval = setInterval(tick, TICK_MS);
  }
};

const stopIfEmpty = (): void => {
  if (interval !== null && Object.keys(timers).length === 0) {
    clearInterval(interval);
    interval = null;
    sinceChime = 0;
    prevDoneSig = "";
  }
};

const startGlobal = (id: string, label: string, minutes: number): void => {
  unlockAudio();
  now = Date.now();
  timers = startTimer(timers, id, label, minutes, now);
  emit();
  ensureTicking();
};

const cancelGlobal = (id: string): void => {
  timers = cancelTimer(timers, id);
  emit();
  stopIfEmpty();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): Snapshot => snapshot;

export const useTimers = (): UseTimers => {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { timers: snap.timers, now: snap.now, start: startGlobal, cancel: cancelGlobal };
};
