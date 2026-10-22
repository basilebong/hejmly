import type { ReactElement, ReactNode } from "react";

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
}: FormDrawerProps): ReactElement => (
  <Drawer
    open={open}
    onOpenChange={(next) => {
      if (next) return;
      onClose();
    }}
  >
    <DrawerContent
      className={cn("rounded-t-3xl bg-white", DRAWER_HEIGHT)}
      onCloseAutoFocus={(e) => {
        if (onClosed === undefined) return;
        e.preventDefault();
        onClosed();
      }}
    >
      <div className="shrink-0 px-5 pt-3">
        <DrawerTitle className="font-semibold text-lg text-slate-900">{title}</DrawerTitle>
        <DrawerDescription className="mt-0.5 text-slate-600 text-sm">
          {description}
        </DrawerDescription>
      </div>
      <div className="flex min-h-0 flex-1 flex-col pt-3 pb-2">{open && children}</div>
    </DrawerContent>
  </Drawer>
);
