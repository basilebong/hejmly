import { CaretRightIcon, ClockIcon, ForkKnifeIcon } from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { formatMinutes, type RecipeSummary } from "../shared/index.ts";
import { Avatar } from "./Avatar.tsx";
import { PhotoPlaceholder } from "./PhotoPlaceholder.tsx";

type RecipeCardProps = { recipe: RecipeSummary; imageSrc: string | null };

export const RecipeCard = ({ recipe, imageSrc }: RecipeCardProps): ReactElement => (
  <div className="flex items-center gap-3.5 py-3">
    {imageSrc === null ? (
      <PhotoPlaceholder label="" className="size-16 shrink-0 rounded-xl" />
    ) : (
      <img
        src={imageSrc}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-16 shrink-0 rounded-xl bg-slate-100 object-cover"
      />
    )}
    <div className="min-w-0 flex-1">
      <div className="truncate font-semibold text-[15px] text-slate-900 leading-tight">
        {recipe.title}
      </div>
      <div className="mt-1.5 flex items-center gap-2.5 text-[12px] text-slate-500">
        <span className="font-semibold text-[10px] text-slate-400 uppercase tracking-wider">
          {recipe.category}
        </span>
        <span className="text-slate-300">·</span>
        <span className="inline-flex items-center gap-1">
          <ClockIcon size={14} className="text-slate-400" />
          {formatMinutes(recipe.minutes)}
        </span>
        <span className="inline-flex items-center gap-1">
          <ForkKnifeIcon size={14} className="text-slate-400" />
          {recipe.serves}
        </span>
        <Avatar cook={recipe.cook} size={16} />
      </div>
    </div>
    <CaretRightIcon size={16} weight="bold" className="text-slate-300" />
  </div>
);
