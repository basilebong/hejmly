import type { CreateItemInput } from "@hejmly/app-grocery/shared";
import {
  defaultGrocerySelection,
  formatMinutes,
  type Ingredient,
  type Recipe,
  RecipeIdSchema,
  type RecipeStep,
  type TimerMap,
} from "@hejmly/app-recipes/shared";
import {
  Avatar,
  CookTimeButton,
  exportRecipePdf,
  IngredientRow,
  IngredientToggle,
  MetaChip,
  PhotoPlaceholder,
  StepCard,
  TimerBar,
  useTimers,
} from "@hejmly/app-recipes/ui";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsSplitIcon,
  BasketIcon,
  ClockIcon,
  CookingPotIcon,
  EyeIcon,
  FilePdfIcon,
  ForkKnifeIcon,
  PencilSimpleIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactElement, useEffect, useState } from "react";
import { toast } from "sonner";
import { match } from "ts-pattern";
import * as v from "valibot";

import { BottomNav } from "@/components/BottomNav";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/cn";
import { createItem } from "@/lib/grocery-api";
import { deleteRecipe, fetchRecipe } from "@/lib/recipes-api";

const ACCENT = "#ff6b35";
const GROCERY_QUERY_KEY = ["grocery", "items"] as const;
const RECIPES_LIST_KEY = ["recipes", "list"] as const;

type Screen = { kind: "read" } | { kind: "method" } | { kind: "cook"; stepIndex: number };

const toGroceryInput = (ingredient: Ingredient): CreateItemInput => {
  const quantity = ingredient.quantity.trim();
  return quantity.length > 0
    ? { name: ingredient.name, description: quantity }
    : { name: ingredient.name };
};

const Shell = ({ children }: { children: ReactElement | ReactElement[] }): ReactElement => (
  <main className="relative flex h-dvh flex-col overflow-hidden bg-slate-50">{children}</main>
);

const Hero = ({ recipe, className }: { recipe: Recipe; className: string }): ReactElement =>
  recipe.image === null ? (
    <PhotoPlaceholder className={className} />
  ) : (
    <img src={recipe.image} alt={recipe.title} className={cn(className, "object-cover")} />
  );

const NotFound = (): ReactElement => (
  <Shell>
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <CookingPotIcon size={40} weight="duotone" className="text-slate-300" />
      <div>
        <p className="font-medium text-base text-slate-900">Recipe not found</p>
        <p className="mt-1 text-slate-500 text-sm">It may have been removed.</p>
      </div>
      <Link
        to="/recipes"
        className="flex min-h-11 items-center justify-center rounded-2xl bg-slate-900 px-6 font-medium text-base text-white transition active:scale-[0.98]"
      >
        Back to recipes
      </Link>
    </div>
    <BottomNav active="recipes" />
  </Shell>
);

const AddToGroceryDrawer = ({
  recipe,
  open,
  onOpenChange,
}: {
  recipe: Recipe;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement => {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<ReadonlyMap<string, boolean>>(() => new Map());

  useEffect(() => {
    if (!open) return;
    setSelected(new Map(Object.entries(defaultGrocerySelection(recipe.ingredients))));
  }, [open, recipe.ingredients]);

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(name, !(prev.get(name) ?? false));
      return next;
    });
  };

  const chosen = recipe.ingredients.filter((i) => selected.get(i.name) ?? false);

  const add = useMutation({
    mutationFn: async (items: readonly Ingredient[]): Promise<number> => {
      await Promise.all(items.map((i) => createItem(toGroceryInput(i))));
      return items.length;
    },
    onSuccess: (count) => {
      toast.success(`Added ${count} item${count === 1 ? "" : "s"} to Grocery`);
      void qc.invalidateQueries({ queryKey: GROCERY_QUERY_KEY });
      onOpenChange(false);
    },
    onError: () => toast.error("Couldn't add to grocery"),
  });

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next && add.isPending) return;
        onOpenChange(next);
      }}
    >
      <DrawerContent className="rounded-t-3xl bg-white">
        <DrawerTitle className="px-5 pt-2 font-semibold text-lg text-slate-900">
          Add to grocery
        </DrawerTitle>
        <DrawerDescription className="px-5 pt-0.5 text-slate-500 text-sm">
          Untick anything you already have at home.
        </DrawerDescription>
        <div className="flex max-h-[60dvh] flex-col overflow-y-auto px-5 pt-2">
          <div className="divide-y divide-slate-100">
            {recipe.ingredients.map((ingredient) => (
              <IngredientToggle
                key={ingredient.name}
                name={ingredient.name}
                quantity={ingredient.quantity}
                haveAtHome={ingredient.haveAtHome}
                checked={selected.get(ingredient.name) ?? false}
                onToggle={() => toggle(ingredient.name)}
              />
            ))}
          </div>
        </div>
        <div className="border-slate-100 border-t px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <button
            type="button"
            disabled={chosen.length === 0 || add.isPending}
            onClick={() => add.mutate(chosen)}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 font-semibold text-base text-white transition active:scale-[0.99] disabled:opacity-40"
          >
            <BasketIcon size={18} weight="bold" />
            {add.isPending
              ? "Adding…"
              : `Add ${chosen.length} item${chosen.length === 1 ? "" : "s"} to Grocery`}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

const StepUses = ({ uses }: { uses: RecipeStep["uses"] }): ReactElement => (
  <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[14px]">
    {uses.map((u) => (
      <span key={u.name} className="text-slate-500">
        {u.name}
        {u.quantity !== null && <span className="text-slate-400 tabular-nums"> {u.quantity}</span>}
      </span>
    ))}
  </div>
);

const CookView = ({
  recipe,
  stepIndex,
  timers,
  now,
  start,
  cancel,
  onExit,
  onStep,
}: {
  recipe: Recipe;
  stepIndex: number;
  timers: TimerMap;
  now: number;
  start: (id: string, label: string, minutes: number) => void;
  cancel: (id: string) => void;
  onExit: () => void;
  onStep: (index: number) => void;
}): ReactElement => {
  const total = recipe.steps.length;
  const step = recipe.steps[stepIndex];
  if (step === undefined) return <NotFound />;
  const isLast = stepIndex === total - 1;

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden bg-white">
      <div className="flex h-12 shrink-0 items-center justify-between px-3 pt-[env(safe-area-inset-top)]">
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit cook mode"
          className="grid size-11 place-items-center rounded-full text-slate-600 transition active:bg-slate-100"
        >
          <XIcon size={18} weight="bold" />
        </button>
        <div className="font-semibold text-[13px] text-slate-500 tabular-nums">
          Step {stepIndex + 1} of {total}
        </div>
        <div className="grid size-11 place-items-center text-slate-300" title="Screen stays on">
          <EyeIcon size={18} />
        </div>
      </div>

      <div className="flex shrink-0 gap-1.5 px-5">
        {recipe.steps.map((s, i) => (
          <span
            key={`${i}-${s.title}`}
            className="h-1 flex-1 rounded-full"
            style={{ background: i <= stepIndex ? ACCENT : "#e2e8f0" }}
          />
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6">
        <div className="flex min-h-full flex-col justify-center py-6">
          {step.concurrent && (
            <div className="mb-3 flex items-center gap-2 font-semibold text-[11px] text-slate-400 uppercase tracking-[0.14em]">
              <ArrowsSplitIcon size={13} weight="bold" /> Meanwhile
            </div>
          )}
          <h2 className="font-semibold text-[28px] text-slate-900 leading-[1.1] tracking-tight">
            {step.title}
          </h2>
          <p className="mt-3 text-pretty text-[18px] text-slate-600 leading-relaxed">{step.body}</p>
          {step.uses.length > 0 && <StepUses uses={step.uses} />}
          {step.timers.length > 0 && (
            <div className="mt-7 flex flex-col gap-2.5">
              {step.timers.map((tm) => (
                <CookTimeButton
                  key={tm.id}
                  id={tm.id}
                  minutes={tm.minutes}
                  label={tm.label}
                  timer={timers[tm.id]}
                  now={now}
                  accent={ACCENT}
                  onStart={start}
                  onCancel={cancel}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <TimerBar />

      <div className="flex shrink-0 items-center gap-3 px-5 pt-2 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
        <button
          type="button"
          disabled={stepIndex === 0}
          onClick={() => onStep(stepIndex - 1)}
          className="inline-flex h-12 items-center gap-1.5 rounded-2xl border border-slate-200 px-5 font-medium text-[15px] text-slate-600 transition active:bg-slate-50 disabled:opacity-40"
        >
          <ArrowLeftIcon size={16} weight="bold" /> Back
        </button>
        <button
          type="button"
          onClick={() => (isLast ? onExit() : onStep(stepIndex + 1))}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-900 font-semibold text-[15px] text-white transition active:scale-[0.99]"
        >
          {isLast ? (
            "Finish"
          ) : (
            <>
              Next step <ArrowRightIcon size={16} weight="bold" />
            </>
          )}
        </button>
      </div>
    </main>
  );
};

const MethodView = ({
  recipe,
  timers,
  now,
  start,
  cancel,
  onBack,
  onCook,
  onExport,
}: {
  recipe: Recipe;
  timers: TimerMap;
  now: number;
  start: (id: string, label: string, minutes: number) => void;
  cancel: (id: string) => void;
  onBack: () => void;
  onCook: () => void;
  onExport: () => void;
}): ReactElement => (
  <Shell>
    <div className="flex h-12 shrink-0 items-center justify-between border-slate-100 border-b bg-white px-3 pt-[env(safe-area-inset-top)]">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to recipe"
        className="grid size-11 place-items-center rounded-full text-slate-600 transition active:bg-slate-100"
      >
        <ArrowLeftIcon size={18} weight="bold" />
      </button>
      <div className="truncate px-2 font-semibold text-[15px] text-slate-900">{recipe.title}</div>
      <button
        type="button"
        onClick={onExport}
        aria-label="Export as PDF"
        className="grid size-11 place-items-center rounded-full text-slate-600 transition active:bg-slate-100"
      >
        <FilePdfIcon size={18} weight="bold" />
      </button>
    </div>
    <div className="flex-1 overflow-y-auto bg-white px-5 pt-4 pb-4">
      <h2 className="font-semibold text-[11px] text-slate-400 uppercase tracking-[0.12em]">
        Instructions
      </h2>
      <div className="mt-1 divide-y divide-slate-100">
        {recipe.steps.map((step, index) => (
          <StepCard
            key={`${index}-${step.title}`}
            step={step}
            index={index}
            accent={ACCENT}
            timers={timers}
            now={now}
            showIngredients
            onStart={start}
            onCancel={cancel}
          />
        ))}
      </div>
    </div>
    <div className="shrink-0 border-slate-100 border-t bg-white px-5 pt-2.5 pb-3">
      <button
        type="button"
        onClick={onCook}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-semibold text-[15px] text-white transition active:scale-[0.99]"
        style={{ background: ACCENT }}
      >
        <CookingPotIcon size={18} weight="fill" />
        Cook mode
      </button>
    </div>
    <BottomNav active="recipes" />
  </Shell>
);

const ReadView = ({
  recipe,
  onStartCooking,
  onExport,
}: {
  recipe: Recipe;
  onStartCooking: () => void;
  onExport: () => void;
}): ReactElement => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const remove = useMutation({
    mutationFn: () => deleteRecipe(recipe.id),
    onSuccess: () => {
      toast.success("Recipe deleted");
      void qc.invalidateQueries({ queryKey: RECIPES_LIST_KEY });
      void navigate({ to: "/recipes" });
    },
    onError: () => toast.error("Couldn't delete recipe"),
  });

  return (
    <Shell>
      <div className="shrink-0 bg-white">
        <div className="flex h-12 items-center justify-between px-2 pt-[env(safe-area-inset-top)]">
          <Link
            to="/recipes"
            aria-label="Back to recipes"
            className="grid size-11 place-items-center rounded-full text-slate-600 transition active:bg-slate-100"
          >
            <ArrowLeftIcon size={18} weight="bold" />
          </Link>
          <div className="flex items-center">
            <Link
              to="/recipes/$recipeId/edit"
              params={{ recipeId: recipe.id }}
              aria-label="Edit recipe"
              className="grid size-11 place-items-center rounded-full text-slate-600 transition active:bg-slate-100"
            >
              <PencilSimpleIcon size={18} weight="bold" />
            </Link>
            <button
              type="button"
              onClick={onExport}
              aria-label="Export as PDF"
              className="grid size-11 place-items-center rounded-full text-slate-600 transition active:bg-slate-100"
            >
              <FilePdfIcon size={18} weight="bold" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete recipe"
              className="grid size-11 place-items-center rounded-full text-slate-600 transition active:bg-rose-50 active:text-rose-600"
            >
              <TrashIcon size={18} weight="bold" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white">
        <div className="px-5 pb-1">
          <Hero recipe={recipe} className="h-40 w-full rounded-2xl" />
        </div>
        <div className="px-5 pt-3">
          <h1 className="font-semibold text-[22px] text-slate-900 leading-tight tracking-tight">
            {recipe.title}
          </h1>
          {recipe.description.length > 0 && (
            <p className="mt-1.5 text-pretty text-[14px] text-slate-500 leading-relaxed">
              {recipe.description}
            </p>
          )}
          <div className="mt-3.5 flex items-center gap-4">
            <MetaChip icon={ClockIcon}>{formatMinutes(recipe.minutes)}</MetaChip>
            <MetaChip icon={ForkKnifeIcon}>Serves {recipe.serves}</MetaChip>
            <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-500">
              <Avatar cook={recipe.cook} size={20} />
              <span className="font-medium text-slate-600">{recipe.cook.name}</span>
            </span>
          </div>
        </div>

        <div className="px-5 pt-5 pb-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-[11px] text-slate-400 uppercase tracking-[0.12em]">
              Ingredients · {recipe.ingredients.length}
            </h2>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-slate-900 pr-3 pl-2.5 font-medium text-[12px] text-white transition active:scale-95"
            >
              <BasketIcon size={14} weight="bold" />
              Add to grocery
            </button>
          </div>
          <div className="mt-1 divide-y divide-slate-100">
            {recipe.ingredients.map((ingredient) => (
              <IngredientRow
                key={ingredient.name}
                name={ingredient.name}
                quantity={ingredient.quantity}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-slate-100 border-t bg-white px-5 pt-2.5 pb-3">
        <button
          type="button"
          onClick={onStartCooking}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-semibold text-[15px] text-white transition active:scale-[0.99]"
          style={{ background: ACCENT }}
        >
          <CookingPotIcon size={18} weight="fill" />
          Start cooking
        </button>
      </div>

      <BottomNav active="recipes" />
      <AddToGroceryDrawer recipe={recipe} open={drawerOpen} onOpenChange={setDrawerOpen} />

      <Drawer
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open && remove.isPending) return;
          setConfirmDelete(open);
        }}
      >
        <DrawerContent
          className="rounded-t-3xl bg-white"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DrawerTitle className="px-5 pt-2 font-semibold text-lg text-slate-900">
            Delete {recipe.title}?
          </DrawerTitle>
          <DrawerDescription className="px-5 pt-1 text-slate-600 text-sm">
            This can't be undone — the recipe will be gone for everyone in the household.
          </DrawerDescription>
          <div className="flex flex-col gap-2.5 px-5 pt-5 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-slate-100 font-medium text-base text-slate-900 transition active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-rose-600 font-medium text-base text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </DrawerContent>
      </Drawer>
    </Shell>
  );
};

const RecipeView = ({ recipe }: { recipe: Recipe }): ReactElement => {
  const [screen, setScreen] = useState<Screen>({ kind: "read" });
  const { timers, now, start, cancel } = useTimers();

  const onExport = (): void => exportRecipePdf(recipe, (m) => toast.error(m));

  return match(screen)
    .with({ kind: "cook" }, (s) => (
      <CookView
        recipe={recipe}
        stepIndex={s.stepIndex}
        timers={timers}
        now={now}
        start={start}
        cancel={cancel}
        onExit={() => setScreen({ kind: "read" })}
        onStep={(index) => setScreen({ kind: "cook", stepIndex: index })}
      />
    ))
    .with({ kind: "method" }, () => (
      <MethodView
        recipe={recipe}
        timers={timers}
        now={now}
        start={start}
        cancel={cancel}
        onBack={() => setScreen({ kind: "read" })}
        onCook={() => setScreen({ kind: "cook", stepIndex: 0 })}
        onExport={onExport}
      />
    ))
    .with({ kind: "read" }, () => (
      <ReadView
        recipe={recipe}
        onStartCooking={() => setScreen({ kind: "method" })}
        onExport={onExport}
      />
    ))
    .exhaustive();
};

export const RecipeDetailScreen = ({ recipeId }: { recipeId: string }): ReactElement => {
  const idResult = v.safeParse(RecipeIdSchema, recipeId);
  const recipe = useQuery({
    queryKey: ["recipes", "detail", recipeId],
    queryFn: () => {
      if (!idResult.success) throw new Error("invalid recipe id");
      return fetchRecipe(idResult.output);
    },
    enabled: idResult.success,
  });

  if (!idResult.success) return <NotFound />;

  if (recipe.isPending) {
    return (
      <Shell>
        <div className="shrink-0 bg-white px-5 pt-[calc(env(safe-area-inset-top)+3rem)]">
          <div className="h-40 w-full animate-pulse rounded-2xl bg-slate-100" />
        </div>
        <div className="flex-1 space-y-3 bg-white px-5 pt-5">
          <div className="h-6 w-2/3 animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
        </div>
        <BottomNav active="recipes" />
      </Shell>
    );
  }

  if (recipe.isError) {
    const message = recipe.error instanceof Error ? recipe.error.message : "";
    if (message.includes("404") || message.includes("not_found")) return <NotFound />;
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <WarningCircleIcon size={40} weight="fill" className="text-slate-300" />
          <div>
            <p className="font-medium text-base text-slate-900">Couldn't load this recipe</p>
            <p className="mt-1 text-slate-500 text-sm">Check your connection and try again.</p>
          </div>
          <button
            type="button"
            onClick={() => void recipe.refetch()}
            className="flex min-h-11 items-center justify-center rounded-2xl bg-slate-900 px-6 font-medium text-base text-white transition active:scale-[0.98]"
          >
            Try again
          </button>
        </div>
        <BottomNav active="recipes" />
      </Shell>
    );
  }

  return <RecipeView recipe={recipe.data} />;
};
