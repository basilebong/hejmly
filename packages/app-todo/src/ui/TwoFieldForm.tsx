import { type FormEvent, type ReactElement, useEffect, useRef, useState } from "react";
import { match } from "ts-pattern";
import type { DraftResult } from "../shared/index.ts";

export type TwoFieldFormCopy = {
  heading: string;
  subheading: string;
  primaryLabel: string;
  primaryPlaceholder: string;
  primaryCapitalize: "words" | "sentences";
  secondaryLabel: string;
  secondaryPlaceholder: string;
  submitLabel: string;
};

type TwoFieldFormProps<T> = {
  copy: TwoFieldFormCopy;
  initialPrimary: string;
  initialSecondary: string;
  pending: boolean;
  selectOnFocus: boolean;
  validate: (primary: string, secondary: string) => DraftResult<T>;
  onSubmit: (value: T) => void;
  onCancel: () => void;
};

export const TwoFieldForm = <T,>({
  copy,
  initialPrimary,
  initialSecondary,
  pending,
  selectOnFocus,
  validate,
  onSubmit,
  onCancel,
}: TwoFieldFormProps<T>): ReactElement => {
  const [primary, setPrimary] = useState(initialPrimary);
  const [secondary, setSecondary] = useState(initialSecondary);
  const [error, setError] = useState<string | null>(null);
  const primaryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
    if (selectOnFocus) primaryRef.current?.select();
  }, [selectOnFocus]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (pending) return;
    match(validate(primary, secondary))
      .with({ kind: "unchanged" }, () => onCancel())
      .with({ kind: "error" }, (r) => setError(r.message))
      .with({ kind: "ok" }, (r) => {
        setError(null);
        onSubmit(r.value);
      })
      .exhaustive();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-1 flex-col px-5 pb-[max(env(safe-area-inset-bottom),1rem)]"
    >
      <div>
        <div className="font-semibold text-lg text-slate-900">{copy.heading}</div>
        <p className="mt-0.5 text-slate-500 text-sm">{copy.subheading}</p>
      </div>

      <div className="mt-5 space-y-3">
        <label className="block">
          <span className="font-medium text-slate-500 text-xs uppercase tracking-wider">
            {copy.primaryLabel}
          </span>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize={copy.primaryCapitalize}
            enterKeyHint="done"
            value={primary}
            onChange={(e) => setPrimary(e.currentTarget.value)}
            placeholder={copy.primaryPlaceholder}
            ref={primaryRef}
            className="mt-1.5 flex min-h-12 w-full items-center rounded-xl border-[1.5px] border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900"
          />
        </label>

        <label className="block">
          <span className="font-medium text-slate-500 text-xs uppercase tracking-wider">
            {copy.secondaryLabel}{" "}
            <span className="font-normal text-slate-500 normal-case tracking-normal">
              — optional
            </span>
          </span>
          <textarea
            inputMode="text"
            autoComplete="off"
            autoCapitalize="sentences"
            rows={2}
            value={secondary}
            onChange={(e) => setSecondary(e.currentTarget.value)}
            placeholder={copy.secondaryPlaceholder}
            className="mt-1.5 flex min-h-12 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900"
          />
        </label>

        {error !== null && (
          <div
            role="alert"
            className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[13px] text-rose-700"
          >
            {error}
          </div>
        )}
      </div>

      <div className="flex-1" />

      <div className="space-y-2.5 pt-4">
        <button
          type="submit"
          disabled={pending}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 font-medium text-base text-white transition active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
        >
          {pending ? "Saving…" : copy.submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex min-h-12 w-full items-center justify-center rounded-2xl text-base text-slate-600 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};
