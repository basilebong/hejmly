import type { ReactElement } from "react";
import {
  type CreateTaskInput,
  diffTaskDraft,
  parseTaskDraft,
  type UpdateTaskInput,
} from "../shared/index.ts";
import { TwoFieldForm, type TwoFieldFormCopy } from "./TwoFieldForm.tsx";

const fields = {
  primaryLabel: "Task",
  primaryPlaceholder: "Order tomato seedlings",
  primaryCapitalize: "sentences",
  secondaryLabel: "Notes",
  secondaryPlaceholder: "Six plants, the cherry kind",
} as const;

const ADD_COPY: TwoFieldFormCopy = {
  ...fields,
  heading: "Add task",
  subheading: "Notes are optional.",
  submitLabel: "Add task",
};

const EDIT_COPY: TwoFieldFormCopy = {
  ...fields,
  heading: "Edit task",
  subheading: "Update the task or its notes.",
  submitLabel: "Save changes",
};

type AddTaskFormProps = {
  onSubmit: (input: CreateTaskInput) => void;
  onCancel: () => void;
};

export const AddTaskForm = ({ onSubmit, onCancel }: AddTaskFormProps): ReactElement => (
  <TwoFieldForm
    copy={ADD_COPY}
    initialPrimary=""
    initialSecondary=""
    pending={false}
    selectOnFocus={false}
    validate={(title, notes) => parseTaskDraft({ title, notes })}
    onSubmit={onSubmit}
    onCancel={onCancel}
  />
);

type EditTaskFormProps = {
  initial: { title: string; notes: string | null };
  pending: boolean;
  onSubmit: (input: UpdateTaskInput) => void;
  onCancel: () => void;
};

export const EditTaskForm = ({
  initial,
  pending,
  onSubmit,
  onCancel,
}: EditTaskFormProps): ReactElement => (
  <TwoFieldForm
    copy={EDIT_COPY}
    initialPrimary={initial.title}
    initialSecondary={initial.notes ?? ""}
    pending={pending}
    selectOnFocus
    validate={(title, notes) => diffTaskDraft(initial, { title, notes })}
    onSubmit={onSubmit}
    onCancel={onCancel}
  />
);
