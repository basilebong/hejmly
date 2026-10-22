import { type ReactElement, useRef } from "react";

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";

type ConfirmDrawerProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  onClosed?: () => void;
};

export const ConfirmDrawer = ({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  onClosed,
}: ConfirmDrawerProps): ReactElement => {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DrawerContent
        className="rounded-t-3xl bg-white"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          if (onClosed === undefined) return;
          e.preventDefault();
          onClosed();
        }}
      >
        <DrawerTitle className="px-5 pt-2 font-semibold text-lg text-slate-900">
          {title}
        </DrawerTitle>
        <DrawerDescription className="px-5 pt-1 text-slate-600 text-sm">
          {description}
        </DrawerDescription>
        <div className="flex flex-col gap-2.5 px-5 pt-5 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-slate-100 font-medium text-base text-slate-900 transition active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-rose-600 font-medium text-base text-white transition active:scale-[0.98]"
          >
            {confirmLabel}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
