import type { DetailTitleProps } from "@hejmly/app-todo/ui";
import { type ReactElement, type ReactNode, type RefObject, useRef } from "react";

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/cn";
import { DRAWER_HEIGHT } from "./FormDrawer.tsx";

type DetailDrawerProps = {
  open: boolean;
  description: string;
  onClose: () => void;
  onClosed: () => void;
  children: (title: {
    ref: RefObject<HTMLHeadingElement | null>;
    render: (props: DetailTitleProps) => ReactElement;
  }) => ReactNode;
};

const renderTitle = ({ className, children, ref }: DetailTitleProps): ReactElement => (
  <DrawerTitle ref={ref} tabIndex={-1} className={className}>
    {children}
  </DrawerTitle>
);

export const DetailDrawer = ({
  open,
  description,
  onClose,
  onClosed,
  children,
}: DetailDrawerProps): ReactElement => {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DrawerContent
        className={cn("rounded-t-3xl bg-white", DRAWER_HEIGHT)}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClosed();
        }}
      >
        <DrawerDescription className="sr-only">{description}</DrawerDescription>
        <div className="flex min-h-0 flex-1 flex-col pt-3">
          {open && children({ ref: titleRef, render: renderTitle })}
        </div>
      </DrawerContent>
    </Drawer>
  );
};
