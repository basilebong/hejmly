import type { ReactElement } from "react";
import {
  type CreateProjectInput,
  diffProjectDraft,
  parseProjectDraft,
  type UpdateProjectInput,
} from "../shared/index.ts";
import { TwoFieldForm, type TwoFieldFormCopy } from "./TwoFieldForm.tsx";

const fields = {
  primaryLabel: "Project",
  primaryPlaceholder: "Spring garden",
  primaryCapitalize: "words",
  secondaryLabel: "Description",
  secondaryPlaceholder: "Beds, seeds and the new fence",
} as const;

const ADD_COPY: TwoFieldFormCopy = {
  ...fields,
  heading: "New project",
  subheading: "Group related tasks together.",
  submitLabel: "Create project",
};

const EDIT_COPY: TwoFieldFormCopy = {
  ...fields,
  heading: "Edit project",
  subheading: "Rename it or change the description.",
  submitLabel: "Save changes",
};

type AddProjectFormProps = {
  onSubmit: (input: CreateProjectInput) => void;
  onCancel: () => void;
};

export const AddProjectForm = ({ onSubmit, onCancel }: AddProjectFormProps): ReactElement => (
  <TwoFieldForm
    copy={ADD_COPY}
    initialPrimary=""
    initialSecondary=""
    pending={false}
    selectOnFocus={false}
    validate={(name, description) => parseProjectDraft({ name, description })}
    onSubmit={onSubmit}
    onCancel={onCancel}
  />
);

type EditProjectFormProps = {
  initial: { name: string; description: string | null };
  pending: boolean;
  onSubmit: (input: UpdateProjectInput) => void;
  onCancel: () => void;
};

export const EditProjectForm = ({
  initial,
  pending,
  onSubmit,
  onCancel,
}: EditProjectFormProps): ReactElement => (
  <TwoFieldForm
    copy={EDIT_COPY}
    initialPrimary={initial.name}
    initialSecondary={initial.description ?? ""}
    pending={pending}
    selectOnFocus
    validate={(name, description) => diffProjectDraft(initial, { name, description })}
    onSubmit={onSubmit}
    onCancel={onCancel}
  />
);
