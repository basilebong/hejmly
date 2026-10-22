import { type ReactElement, type ReactNode, useRef } from "react";

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/cn";

type FormDrawerProps = {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  onClosed?: () => void;
  children: ReactNode;
};

export const DRAWER_HEIGHT =
  "data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-env(safe-area-inset-top)-1.5rem)]";

export const FormDrawer = ({
  open,
  title,
  description,
  onClose,
  onClosed,
  children,
}: FormDrawerProps): ReactElement => {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        onClose();
      }}
    >
      <DrawerContent
        className={cn("rounded-t-3xl bg-white", DRAWER_HEIGHT)}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const content = e.currentTarget;
          if (content instanceof Node && content.contains(document.activeElement)) return;
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          if (onClosed === undefined) return;
          e.preventDefault();
          onClosed();
        }}
      >
        <div className="shrink-0 px-5 pt-3">
          <DrawerTitle
            ref={titleRef}
            tabIndex={-1}
            className="font-semibold text-lg text-slate-900 outline-none"
          >
            {title}
          </DrawerTitle>
          <DrawerDescription className="mt-0.5 text-slate-600 text-sm">
            {description}
          </DrawerDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col pt-3 pb-2">{open && children}</div>
      </DrawerContent>
    </Drawer>
  );
};
