import type { CreateRecipeInput } from "@hejmly/app-recipes/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactElement, useRef } from "react";
import { toast } from "sonner";
import { createRecipe } from "@/lib/recipes-api";
import { RecipeForm } from "./RecipeForm";

export const CreateRecipeScreen = (): ReactElement => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const idempotencyKey = useRef(crypto.randomUUID());

  const create = useMutation({
    mutationFn: (input: CreateRecipeInput) => createRecipe(input, idempotencyKey.current),
    onSuccess: (recipe) => {
      void qc.invalidateQueries({ queryKey: ["recipes", "list"] });
      toast.success("Recipe saved");
      void navigate({ to: "/recipes/$recipeId", params: { recipeId: recipe.id } });
    },
    onError: () => {
      if (!navigator.onLine) {
        void qc.invalidateQueries({ queryKey: ["recipes", "list"] });
        toast.success("Saved offline — will sync when you reconnect");
        void navigate({ to: "/recipes" });
        return;
      }
      toast.error("Couldn't save recipe");
    },
  });

  return (
    <RecipeForm
      heading="New recipe"
      submitLabel="Save recipe"
      pending={create.isPending}
      cancelSlot={
        <Link
          to="/recipes"
          className="px-2 font-medium text-[15px] text-slate-500 active:text-slate-700"
        >
          Cancel
        </Link>
      }
      onSubmit={(input) => create.mutate(input)}
    />
  );
};
