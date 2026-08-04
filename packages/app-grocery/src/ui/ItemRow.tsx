import { ArrowsClockwiseIcon, CheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactElement } from "react";
import type { GroceryItem } from "../shared/index.ts";
import { Avatar } from "./Avatar.tsx";
import { cn } from "./cn.ts";
import { RowActionsMenu } from "./RowActionsMenu.tsx";

export type ItemSyncState = "synced" | "queued" | "error";

type ItemRowProps = {
  item: GroceryItem;
  syncState?: ItemSyncState;
  onToggle?: (next: boolean) => void;
  onRetry?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
};

export const ItemRow = ({
  item,
  syncState = "synced",
  onToggle,
  onRetry,
  onEdit,
  onRemove,
}: ItemRowProps): ReactElement => {
  const purchased = item.status.kind === "purchased";
  const queued = syncState === "queued";
  const error = syncState === "error";

  const nameClass = purchased
    ? "text-slate-400 line-through decoration-slate-300"
    : queued
      ? "italic text-slate-400"
      : "text-slate-900";

  const descClass = purchased
    ? "text-slate-300 line-through decoration-slate-200"
    : queued
      ? "italic text-slate-400"
      : "text-slate-500";

  return (
    <li className="relative flex min-h-[60px] items-center gap-3 bg-white py-3.5 pr-2 pl-5">
      <button
        type="button"
        onClick={onToggle ? () => onToggle(!purchased) : undefined}
        className="-m-2.5 flex size-11 shrink-0 items-center justify-center"
        aria-pressed={purchased}
        aria-label={purchased ? `Mark ${item.name} as unbought` : `Mark ${item.name} as bought`}
      >
        {purchased ? (
          <span className="grid size-6 place-items-center rounded-full bg-slate-900">
            <CheckIcon size={13} weight="bold" className="text-white" />
          </span>
        ) : (
          <span className="size-6 rounded-full border-[1.5px] border-slate-300" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className={cn("truncate font-medium text-base leading-tight", nameClass)}>
            {item.name}
          </span>
          {queued && (
            <span className="inline-flex items-center gap-1 font-semibold text-[10px] text-slate-400 uppercase not-italic tracking-wider">
              <span className="size-1.5 animate-pulse rounded-full bg-slate-400" />
              Saving
            </span>
          )}
          {error && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 font-semibold text-[10px] text-rose-600 uppercase tracking-wider"
            >
              <WarningCircleIcon size={11} weight="fill" />
              Retry
            </button>
          )}
        </div>
        {item.description !== null && item.description.length > 0 && (
          <div className={cn("mt-0.5 truncate text-sm leading-snug", descClass)}>
            {item.description}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {!queued && !error && <Avatar author={item.addedBy} />}
        {queued && <ArrowsClockwiseIcon size={16} className="animate-spin text-slate-300" />}
        {onRemove && onToggle && onEdit && !queued && !error && (
          <RowActionsMenu
            itemName={item.name}
            purchased={purchased}
            onToggle={() => onToggle(!purchased)}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        )}
      </div>
    </li>
  );
};
