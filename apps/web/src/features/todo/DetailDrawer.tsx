import type { ReactElement, ReactNode } from "react";

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";

type DetailDrawerProps = {
  open: boolean;
  description: string;
  onClose: () => void;
  children: (
    renderTitle: (props: { className: string; children: ReactNode }) => ReactElement,
  ) => ReactNode;
};

const renderTitle = ({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}): ReactElement => <DrawerTitle className={className}>{children}</DrawerTitle>;

export const DetailDrawer = ({
  open,
  description,
  onClose,
  children,
}: DetailDrawerProps): ReactElement => (
  <Drawer
    open={open}
    onOpenChange={(next) => {
      if (!next) onClose();
    }}
  >
    <DrawerContent className="rounded-t-3xl bg-white">
      <DrawerDescription className="sr-only">{description}</DrawerDescription>
      <div className="flex min-h-0 flex-1 flex-col pt-3">{open && children(renderTitle)}</div>
    </DrawerContent>
  </Drawer>
);
