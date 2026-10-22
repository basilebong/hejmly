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
import { DuePicker } from "./DuePicker.tsx";
import { MemberPicker } from "./MemberPicker.tsx";

type Copy = { heading: string; submitLabel: string };

type TaskFormProps<T> = {
  copy: Copy;
  initial: TaskDraft;
  members: readonly TodoMember[];
  meId: UserId | null;
  today: DueDate;
  validate: (draft: TaskDraft) => DraftResult<T>;
  onSubmit: (value: T) => void;
  onCancel: () => void;
};

const labelClass = "font-medium text-slate-500 text-xs uppercase tracking-wider";
const optionalHint = (
  <span className="font-normal text-slate-500 normal-case tracking-normal"> — optional</span>
);

const singleLine = (raw: string): string => raw.replace(/\s*[\r\n]+\s*/g, " ");

const TaskForm = <T,>({
  copy,
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
  const ids = { title: useId(), notes: useId(), due: useId() };

  useEffect(() => {
    const el = titleRef.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    match(validate(draft))
      .with({ kind: "unchanged" }, () => onCancel())
      .with({ kind: "error" }, (r) => setError(r.message))
      .with({ kind: "ok" }, (r) => {
        setError(null);
        onSubmit(r.value);
      })
      .exhaustive();
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-2">
        <div className="font-semibold text-lg text-slate-900">{copy.heading}</div>

        <div className="mt-5 space-y-5">
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
              className="mt-1.5 block max-h-40 min-h-12 w-full resize-none rounded-xl border-[1.5px] border-slate-200 bg-white px-4 py-2.5 font-medium text-base text-slate-900 leading-snug outline-none transition-colors [field-sizing:content] placeholder:font-normal placeholder:text-slate-400 focus:border-slate-900"
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
            <legend className={labelClass}>Assigned to{optionalHint}</legend>
            <div className="mt-1.5">
              <MemberPicker
                label="Assigned to"
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
              className="mt-1.5 block min-h-24 w-full resize-none rounded-xl border-[1.5px] border-slate-200 bg-white px-4 py-2.5 text-base text-slate-700 leading-relaxed outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900"
            />
          </div>

          {error !== null && (
            <div
              role="alert"
              className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[13px] text-rose-700"
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
          {copy.submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex min-h-12 w-full items-center justify-center rounded-2xl text-base text-slate-600"
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
    copy={{ heading: "Add task", submitLabel: "Add task" }}
    initial={EMPTY}
    validate={parseTaskDraft}
    onSubmit={onSubmit}
  />
);

export const EditTaskForm = ({
  initial,
  onSubmit,
  ...shared
}: SharedProps & {
  initial: Task;
  onSubmit: (input: UpdateTaskInput) => void;
}): ReactElement => {
  const current = {
    title: initial.title,
    notes: initial.notes,
    dueOn: initial.dueOn,
    assigneeId: initial.assignee?.id ?? null,
  };
  return (
    <TaskForm
      {...shared}
      copy={{ heading: "Edit task", submitLabel: "Save changes" }}
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
