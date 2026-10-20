import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  DotsThreeVerticalIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactElement } from "react";
import { cn } from "./cn.ts";
import { menuContentClass, menuItemClass } from "./menu.ts";

type TaskActionsMenuProps = {
  taskTitle: string;
  done: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
};

export const TaskActionsMenu = ({
  taskTitle,
  done,
  onToggle,
  onEdit,
  onRemove,
}: TaskActionsMenuProps): ReactElement => (
  <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button
        type="button"
        className="grid size-11 shrink-0 place-items-center rounded-full text-slate-400 outline-none transition active:bg-slate-100 data-[state=open]:bg-slate-100"
        aria-label={`Actions for ${taskTitle}`}
      >
        <DotsThreeVerticalIcon size={18} weight="bold" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end"
        sideOffset={4}
        collisionPadding={12}
        className={menuContentClass}
      >
        <DropdownMenu.Item onSelect={onToggle} className={cn(menuItemClass, "text-slate-700")}>
          {done ? (
            <>
              <ArrowCounterClockwiseIcon size={18} />
              Reopen
            </>
          ) : (
            <>
              <CheckCircleIcon size={18} />
              Mark done
            </>
          )}
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={onEdit} className={cn(menuItemClass, "text-slate-700")}>
          <PencilSimpleIcon size={18} />
          Edit
        </DropdownMenu.Item>
        <DropdownMenu.Separator className="mx-3 my-1 h-px bg-slate-100" />
        <DropdownMenu.Item onSelect={onRemove} className={cn(menuItemClass, "text-rose-600")}>
          <TrashIcon size={18} />
          Remove
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);
