import {
  type CreateRecipeInput,
  RECIPE_CATEGORIES,
  type RecipeCategory,
} from "@hejmly/app-recipes/shared";
import { PhotoInput, TimerBar } from "@hejmly/app-recipes/ui";
import { MinusIcon, PlusIcon, TimerIcon, XIcon } from "@phosphor-icons/react";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/cn";

const ACCENT = "#ff6b35";

export type RecipeFormValues = {
  title: string;
  category: RecipeCategory;
  description: string;
  image: string | null;
  minutes: number;
  serves: number;
  ingredients: ReadonlyArray<{ name: string; quantity: string }>;
  steps: ReadonlyArray<{ title: string; body: string; timers: readonly string[] }>;
};

type RecipeFormProps = {
  heading: string;
  submitLabel: string;
  pending: boolean;
  cancelSlot: ReactNode;
  initial?: RecipeFormValues;
  onSubmit: (input: CreateRecipeInput) => void;
};

type IngredientDraft = { id: string; name: string; quantity: string };
type TimerDraft = { id: string; minutes: string };
type StepDraft = { id: string; title: string; body: string; timers: TimerDraft[] };

const newIngredient = (): IngredientDraft => ({ id: crypto.randomUUID(), name: "", quantity: "" });
const newStep = (): StepDraft => ({ id: crypto.randomUUID(), title: "", body: "", timers: [] });
const newTimer = (): TimerDraft => ({ id: crypto.randomUUID(), minutes: "5" });

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const onlyDigits = (value: string): string => value.replace(/[^0-9]/g, "");

const seedIngredients = (initial: RecipeFormValues | undefined): IngredientDraft[] =>
  initial !== undefined && initial.ingredients.length > 0
    ? initial.ingredients.map((i) => ({
        id: crypto.randomUUID(),
        name: i.name,
        quantity: i.quantity,
      }))
    : [newIngredient()];

const seedSteps = (initial: RecipeFormValues | undefined): StepDraft[] =>
  initial !== undefined && initial.steps.length > 0
    ? initial.steps.map((s) => ({
        id: crypto.randomUUID(),
        title: s.title,
        body: s.body,
        timers: s.timers.map((minutes) => ({ id: crypto.randomUUID(), minutes })),
      }))
    : [newStep()];

const Field = ({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: ReactNode;
}): ReactElement => (
  <div>
    <span className="font-semibold text-[11px] text-slate-500 uppercase tracking-wider">
      {label}
      {optional && (
        <span className="font-normal text-slate-400 normal-case tracking-normal"> — optional</span>
      )}
    </span>
    <div className="mt-1.5">{children}</div>
  </div>
);

const Stepper = ({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  onChange: (next: number) => void;
}): ReactElement => {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const handleInput = (raw: string): void => {
    const digits = onlyDigits(raw);
    setDraft(digits);
    const parsed = Number.parseInt(digits, 10);
    if (Number.isFinite(parsed)) onChange(parsed);
  };

  return (
    <div>
      <span className="font-semibold text-[11px] text-slate-500 uppercase tracking-wider">
        {label}
      </span>
      <div className="mt-1.5 flex min-h-12 items-center justify-between rounded-xl border border-slate-200 bg-white px-3 transition-colors focus-within:border-slate-900">
        <div className="flex min-w-0 items-baseline gap-1">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={label}
            value={draft}
            onChange={(e) => handleInput(e.currentTarget.value)}
            onBlur={() => setDraft(String(value))}
            style={{ width: `${Math.max(draft.length, 1)}ch` }}
            className="bg-transparent font-medium text-base text-slate-900 tabular-nums outline-none"
          />
          {suffix !== undefined && <span className="text-[15px] text-slate-400">{suffix}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={`Decrease ${label}`}
            onClick={() => onChange(value - 1)}
            className="group/dec -m-1.5 grid size-11 place-items-center"
          >
            <span className="grid size-8 place-items-center rounded-lg border border-slate-200 text-slate-600 transition group-active/dec:bg-slate-50">
              <MinusIcon size={14} weight="bold" />
            </span>
          </button>
          <button
            type="button"
            aria-label={`Increase ${label}`}
            onClick={() => onChange(value + 1)}
            className="group/inc -m-1.5 grid size-11 place-items-center"
          >
            <span className="grid size-8 place-items-center rounded-lg border border-slate-200 text-slate-600 transition group-active/inc:bg-slate-50">
              <PlusIcon size={14} weight="bold" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

const RemoveButton = ({ label, onClick }: { label: string; onClick: () => void }): ReactElement => (
  <button
    type="button"
    aria-label={label}
    onClick={onClick}
    className="grid size-11 shrink-0 place-items-center rounded-lg text-slate-300 transition active:bg-slate-100 active:text-slate-500"
  >
    <XIcon size={14} weight="bold" />
  </button>
);

const textInput =
  "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900";

export const RecipeForm = ({
  heading,
  submitLabel,
  pending,
  cancelSlot,
  initial,
  onSubmit,
}: RecipeFormProps): ReactElement => {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState<RecipeCategory>(initial?.category ?? "Main");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [image, setImage] = useState<string | null>(initial?.image ?? null);
  const [minutes, setMinutes] = useState(initial?.minutes ?? 30);
  const [serves, setServes] = useState(initial?.serves ?? 2);
  const [ingredients, setIngredients] = useState<IngredientDraft[]>(() => seedIngredients(initial));
  const [steps, setSteps] = useState<StepDraft[]>(() => seedSteps(initial));
  const [error, setError] = useState<string | null>(null);

  const setIngredient = (index: number, patch: Partial<IngredientDraft>): void =>
    setIngredients((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const setStep = (index: number, patch: Partial<StepDraft>): void =>
    setSteps((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const addTimer = (stepIndex: number): void =>
    setSteps((prev) =>
      prev.map((row, i) =>
        i === stepIndex ? { ...row, timers: [...row.timers, newTimer()] } : row,
      ),
    );
  const setTimer = (stepIndex: number, timerId: string, value: string): void =>
    setSteps((prev) =>
      prev.map((row, i) =>
        i === stepIndex
          ? {
              ...row,
              timers: row.timers.map((t) => (t.id === timerId ? { ...t, minutes: value } : t)),
            }
          : row,
      ),
    );
  const removeTimer = (stepIndex: number, timerId: string): void =>
    setSteps((prev) =>
      prev.map((row, i) =>
        i === stepIndex ? { ...row, timers: row.timers.filter((t) => t.id !== timerId) } : row,
      ),
    );

  const handleSave = (): void => {
    const cleanIngredients = ingredients
      .map((i) => ({ name: i.name.trim(), quantity: i.quantity.trim() }))
      .filter((i) => i.name.length > 0);
    const cleanSteps = steps
      .map((s) => ({
        title: s.title.trim(),
        body: s.body.trim(),
        timers: s.timers
          .map((t) => ({ id: t.id, minutes: Number.parseInt(t.minutes, 10) }))
          .filter((t) => Number.isFinite(t.minutes) && t.minutes > 0),
      }))
      .filter((s) => s.title.length > 0 && s.body.length > 0);

    if (title.trim().length === 0) {
      setError("Give your recipe a title.");
      return;
    }
    if (cleanIngredients.length === 0) {
      setError("Add at least one ingredient.");
      return;
    }
    if (cleanSteps.length === 0) {
      setError("Add at least one step with instructions.");
      return;
    }

    const input: CreateRecipeInput = {
      title: title.trim(),
      description: description.trim(),
      category,
      minutes,
      serves,
      ...(image !== null ? { image } : {}),
      ingredients: cleanIngredients.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        haveAtHome: false,
      })),
      steps: cleanSteps.map((s) => ({
        title: s.title,
        body: s.body,
        concurrent: false,
        uses: [],
        timers: s.timers.map((t) => ({
          id: t.id,
          minutes: clamp(t.minutes, 1, 1440),
          label: s.title,
        })),
      })),
    };

    setError(null);
    onSubmit(input);
  };

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-slate-50">
      <header className="flex h-12 shrink-0 items-center justify-between border-slate-100 border-b bg-white px-3 pt-[env(safe-area-inset-top)]">
        {cancelSlot}
        <div className="font-semibold text-[15px] text-slate-900">{heading}</div>
        <div className="w-[52px] shrink-0" />
      </header>

      <div className="flex-1 overflow-y-auto bg-white px-5 pt-4 pb-6">
        <div className="space-y-4">
          <PhotoInput value={image} onChange={setImage} onError={(m) => toast.error(m)} />

          <Field label="Title">
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="words"
              aria-label="Title"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              placeholder="Tomato Butter Rigatoni"
              className={textInput}
            />
          </Field>

          <Field label="Category">
            <div className="flex flex-wrap gap-2">
              {RECIPE_CATEGORIES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCategory(option)}
                  aria-pressed={category === option}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-xl px-3.5 font-medium text-[13px] transition",
                    category === option
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-600",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Description" optional>
            <textarea
              inputMode="text"
              autoComplete="off"
              autoCapitalize="sentences"
              aria-label="Description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              placeholder="A glossy, almost-creamy tomato sauce."
              className="min-h-12 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Stepper
              label="Total time"
              value={minutes}
              suffix="min"
              onChange={(next) => setMinutes(clamp(next, 1, 1440))}
            />
            <Stepper
              label="Serves"
              value={serves}
              onChange={(next) => setServes(clamp(next, 1, 50))}
            />
          </div>
        </div>

        <div className="mt-6">
          <h2 className="font-semibold text-[11px] text-slate-400 uppercase tracking-[0.12em]">
            Ingredients
          </h2>
          <div className="mt-2.5 space-y-2">
            {ingredients.map((row, index) => (
              <div key={row.id} className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  aria-label={`Ingredient ${index + 1} name`}
                  value={row.name}
                  onChange={(e) => setIngredient(index, { name: e.currentTarget.value })}
                  placeholder="Ingredient"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900"
                />
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  aria-label={`Ingredient ${index + 1} quantity`}
                  value={row.quantity}
                  onChange={(e) => setIngredient(index, { quantity: e.currentTarget.value })}
                  placeholder="Qty"
                  className="min-h-11 w-[84px] rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900 tabular-nums outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900"
                />
                {ingredients.length > 1 && (
                  <RemoveButton
                    label={`Remove ingredient ${index + 1}`}
                    onClick={() => setIngredients((prev) => prev.filter((_, i) => i !== index))}
                  />
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setIngredients((prev) => [...prev, newIngredient()])}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 border-dashed font-medium text-[14px] text-slate-500 transition active:bg-slate-50"
            >
              <PlusIcon size={15} weight="bold" />
              Add ingredient
            </button>
          </div>
        </div>

        <div className="mt-6">
          <h2 className="font-semibold text-[11px] text-slate-400 uppercase tracking-[0.12em]">
            Steps
          </h2>
          <div className="mt-2.5 space-y-4">
            {steps.map((row, index) => (
              <div key={row.id} className="flex gap-3">
                <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-slate-900 font-semibold text-[13px] text-white">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      autoCapitalize="sentences"
                      aria-label={`Step ${index + 1} title`}
                      value={row.title}
                      onChange={(e) => setStep(index, { title: e.currentTarget.value })}
                      placeholder="Step title"
                      className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900"
                    />
                    {steps.length > 1 && (
                      <RemoveButton
                        label={`Remove step ${index + 1}`}
                        onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
                      />
                    )}
                  </div>
                  <textarea
                    inputMode="text"
                    autoComplete="off"
                    autoCapitalize="sentences"
                    aria-label={`Step ${index + 1} instructions`}
                    rows={2}
                    value={row.body}
                    onChange={(e) => setStep(index, { body: e.currentTarget.value })}
                    placeholder="What to do…"
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-base text-slate-700 leading-relaxed outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    {row.timers.map((timer, timerIndex) => (
                      <span
                        key={timer.id}
                        className="inline-flex h-11 items-center gap-1 rounded-full pr-1 pl-3 font-semibold text-[13px] text-white"
                        style={{ background: ACCENT }}
                      >
                        <TimerIcon size={15} weight="fill" />
                        <input
                          inputMode="numeric"
                          autoComplete="off"
                          aria-label={`Step ${index + 1} timer ${timerIndex + 1} minutes`}
                          value={timer.minutes}
                          onChange={(e) =>
                            setTimer(index, timer.id, onlyDigits(e.currentTarget.value))
                          }
                          placeholder="5"
                          style={{ width: `${Math.max(timer.minutes.length, 1)}ch` }}
                          className="bg-transparent text-center text-base text-white tabular-nums outline-none placeholder:text-white/60"
                        />
                        min
                        <button
                          type="button"
                          aria-label={`Remove timer ${timerIndex + 1}`}
                          onClick={() => removeTimer(index, timer.id)}
                          className="group/rmt -mr-1 grid size-11 place-items-center"
                        >
                          <span className="grid size-6 place-items-center rounded-full bg-white/25 transition group-active/rmt:bg-white/40">
                            <XIcon size={11} weight="bold" />
                          </span>
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => addTimer(index)}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-300 border-dashed px-4 font-medium text-[13px] text-slate-500 transition active:bg-slate-50"
                    >
                      <PlusIcon size={13} weight="bold" />
                      Add a time
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setSteps((prev) => [...prev, newStep()])}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 border-dashed font-medium text-[14px] text-slate-500 transition active:bg-slate-50"
            >
              <PlusIcon size={15} weight="bold" />
              Add step
            </button>
          </div>
        </div>

        {error !== null && (
          <div className="mt-4 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            {error}
          </div>
        )}
      </div>

      <TimerBar />

      <div className="shrink-0 border-slate-100 border-t bg-white px-5 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <button
          type="button"
          disabled={pending}
          onClick={handleSave}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 font-semibold text-base text-white transition active:scale-[0.99] disabled:opacity-40"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </main>
  );
};
