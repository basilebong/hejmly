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
  submitLabel: "Create project",
};

const EDIT_COPY: TwoFieldFormCopy = {
  ...fields,
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
    selectOnFocus={false}
    validate={(name, description) => parseProjectDraft({ name, description })}
    onSubmit={onSubmit}
    onCancel={onCancel}
  />
);

type EditProjectFormProps = {
  initial: { name: string; description: string | null };
  onSubmit: (input: UpdateProjectInput) => void;
  onCancel: () => void;
};

export const EditProjectForm = ({
  initial,
  onSubmit,
  onCancel,
}: EditProjectFormProps): ReactElement => (
  <TwoFieldForm
    copy={EDIT_COPY}
    initialPrimary={initial.name}
    initialSecondary={initial.description ?? ""}
    selectOnFocus
    validate={(name, description) => diffProjectDraft(initial, { name, description })}
    onSubmit={onSubmit}
    onCancel={onCancel}
  />
);
