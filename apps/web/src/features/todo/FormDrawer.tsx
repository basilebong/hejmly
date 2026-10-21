import type { ReactElement, ReactNode } from "react";

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";

type FormDrawerProps = {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
};

export const FormDrawer = ({
  open,
  title,
  description,
  onClose,
  children,
}: FormDrawerProps): ReactElement => (
  <Drawer
    open={open}
    onOpenChange={(next) => {
      if (next) return;
      onClose();
    }}
  >
    <DrawerContent className="rounded-t-3xl bg-white">
      <DrawerTitle className="sr-only">{title}</DrawerTitle>
      <DrawerDescription className="sr-only">{description}</DrawerDescription>
      <div className="flex max-h-[70dvh] flex-col pt-3 pb-2">{open && children}</div>
    </DrawerContent>
  </Drawer>
);
