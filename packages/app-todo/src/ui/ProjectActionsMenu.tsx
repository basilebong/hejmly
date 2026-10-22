import { DotsThreeIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { type ReactElement, useRef } from "react";
import { cn } from "./cn.ts";
import { menuContentClass, menuItemClass } from "./menu.ts";

type ProjectActionsMenuProps = {
  projectName: string;
  onEdit: (trigger: HTMLElement | null) => void;
  onRemove: (trigger: HTMLElement | null) => void;
};

export const ProjectActionsMenu = ({
  projectName,
  onEdit,
  onRemove,
}: ProjectActionsMenuProps): ReactElement => {
  const trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          ref={trigger}
          type="button"
          className="grid size-11 shrink-0 place-items-center rounded-full text-slate-600 outline-none transition active:bg-slate-100 data-[state=open]:bg-slate-100"
          aria-label={`Actions for ${projectName}`}
        >
          <DotsThreeIcon size={20} weight="bold" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className={menuContentClass}
        >
          <DropdownMenu.Item
            onSelect={() => onEdit(trigger.current)}
            className={cn(menuItemClass, "text-slate-700")}
          >
            <PencilSimpleIcon size={18} />
            Edit project
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-3 my-1 h-px bg-slate-100" />
          <DropdownMenu.Item
            onSelect={() => onRemove(trigger.current)}
            className={cn(menuItemClass, "text-rose-600")}
          >
            <TrashIcon size={18} />
            Delete project
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
