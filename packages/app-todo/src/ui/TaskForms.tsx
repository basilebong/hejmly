import type { UserId } from "@hejmly/core/shared";
import { type FormEvent, type ReactElement, useEffect, useId, useRef, useState } from "react";
import { match } from "ts-pattern";
import {
  type CreateTaskInput,
  type DraftResult,
  type DueDate,
  diffTaskDraft,
  parseTaskDraft,
  type Task,
  type TaskDraft,
  type TodoMember,
  type UpdateTaskInput,
} from "../shared/index.ts";
import { cn } from "./cn.ts";
import { DuePicker } from "./DuePicker.tsx";
import { MemberPicker } from "./MemberPicker.tsx";

type TaskFormProps<T> = {
  submitLabel: string;
  autoFocusTitle: boolean;
  initial: TaskDraft;
  members: readonly TodoMember[];
  meId: UserId | null;
  today: DueDate;
  validate: (draft: TaskDraft) => DraftResult<T>;
  onSubmit: (value: T) => void;
  onCancel: () => void;
};

const labelClass = "font-medium text-slate-600 text-xs uppercase tracking-wider";
const optionalHint = (
  <span className="font-normal text-slate-500 normal-case tracking-normal"> — optional</span>
);
const fieldClass =
  "mt-1.5 block w-full resize-none rounded-xl border-[1.5px] border-slate-500 bg-white px-4 py-2.5 text-base outline-none transition-colors placeholder:text-slate-500 focus:border-slate-900 focus:ring-1 focus:ring-slate-900";

const singleLine = (raw: string): string => raw.replace(/\s*[\r\n]+\s*/g, " ");

const TaskForm = <T,>({
  submitLabel,
  autoFocusTitle,
  initial,
  members,
  meId,
  today,
  validate,
  onSubmit,
  onCancel,
}: TaskFormProps<T>): ReactElement => {
  const [draft, setDraft] = useState<TaskDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const ids = { title: useId(), notes: useId(), due: useId(), assignee: useId(), error: useId() };

  useEffect(() => {
    if (!autoFocusTitle) return;
    titleRef.current?.focus();
  }, [autoFocusTitle]);

  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    match(validate(draft))
      .with({ kind: "unchanged" }, () => onCancel())
      .with({ kind: "error" }, (r) => {
        setError(r.message);
        titleRef.current?.focus();
      })
      .with({ kind: "ok" }, (r) => {
        setError(null);
        onSubmit(r.value);
      })
      .exhaustive();
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2">
        <div className="mt-2 space-y-5">
          <div>
            <label htmlFor={ids.title} className={labelClass}>
              Task
            </label>
            <textarea
              id={ids.title}
              ref={titleRef}
              rows={2}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="sentences"
              enterKeyHint="done"
              value={draft.title}
              onChange={(e) => set("title", singleLine(e.currentTarget.value))}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                formRef.current?.requestSubmit();
              }}
              placeholder="Order tomato seedlings"
              aria-invalid={error !== null}
              aria-describedby={error === null ? undefined : ids.error}
              className={cn(
                fieldClass,
                "max-h-40 min-h-12 font-medium text-slate-900 leading-snug [field-sizing:content] placeholder:font-normal",
              )}
            />
          </div>

          <fieldset>
            <legend className={labelClass}>Due{optionalHint}</legend>
            <div className="mt-1.5">
              <DuePicker
                id={ids.due}
                value={draft.dueOn}
                today={today}
                onChange={(next) => set("dueOn", next)}
              />
            </div>
          </fieldset>

          <fieldset>
            <legend id={ids.assignee} className={labelClass}>
              Assigned to{optionalHint}
            </legend>
            <div className="mt-1.5">
              <MemberPicker
                labelledBy={ids.assignee}
                members={members}
                meId={meId}
                value={draft.assigneeId}
                onChange={(next) => set("assigneeId", next)}
              />
            </div>
          </fieldset>

          <div>
            <label htmlFor={ids.notes} className={labelClass}>
              Notes{optionalHint}
            </label>
            <textarea
              id={ids.notes}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="sentences"
              rows={4}
              value={draft.notes}
              onChange={(e) => set("notes", e.currentTarget.value)}
              placeholder="Six plants, the cherry kind"
              className={cn(fieldClass, "min-h-24 text-slate-800 leading-relaxed")}
            />
          </div>

          {error !== null && (
            <div
              id={ids.error}
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 text-sm"
            >
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 space-y-2.5 border-slate-100 border-t bg-white px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <button
          type="submit"
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 font-medium text-base text-white transition active:scale-[0.98]"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-12 w-full items-center justify-center rounded-2xl text-base text-slate-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

type SharedProps = {
  members: readonly TodoMember[];
  meId: UserId | null;
  today: DueDate;
  onCancel: () => void;
};

const EMPTY: TaskDraft = { title: "", notes: "", dueOn: "", assigneeId: null };

export const AddTaskForm = ({
  onSubmit,
  ...shared
}: SharedProps & { onSubmit: (input: CreateTaskInput) => void }): ReactElement => (
  <TaskForm
    {...shared}
    submitLabel="Add task"
    autoFocusTitle
    initial={EMPTY}
    validate={parseTaskDraft}
    onSubmit={onSubmit}
  />
);

export const EditTaskForm = ({
  initial,
  onSubmit,
  members,
  ...shared
}: SharedProps & {
  initial: Task;
  onSubmit: (input: UpdateTaskInput) => void;
}): ReactElement => {
  const [current] = useState(() => ({
    title: initial.title,
    notes: initial.notes,
    dueOn: initial.dueOn,
    assigneeId: initial.assignee?.id ?? null,
  }));
  const [assignee] = useState(initial.assignee);
  const choices =
    assignee === null || members.some((m) => m.id === assignee.id)
      ? members
      : [...members, assignee];
  return (
    <TaskForm
      {...shared}
      members={choices}
      submitLabel="Save changes"
      autoFocusTitle={false}
      initial={{
        title: current.title,
        notes: current.notes ?? "",
        dueOn: current.dueOn ?? "",
        assigneeId: current.assigneeId,
      }}
      validate={(draft) => diffTaskDraft(current, draft)}
      onSubmit={onSubmit}
    />
  );
};
