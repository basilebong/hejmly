import type { UserId } from "@hejmly/core/shared";
import { UserCircleIcon } from "@phosphor-icons/react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import type { ReactElement } from "react";
import type { TodoMember } from "../shared/index.ts";
import { Avatar } from "./Avatar.tsx";

const NOBODY = "";

type MemberPickerProps = {
  labelledBy: string;
  members: readonly TodoMember[];
  meId: UserId | null;
  value: UserId | null;
  onChange: (next: UserId | null) => void;
};

const optionClass =
  "flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-slate-300 bg-white py-1.5 pr-3.5 pl-1.5 text-[15px] text-slate-700 outline-none transition data-[state=checked]:border-slate-900 data-[state=checked]:bg-slate-900 data-[state=checked]:text-white focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2";

export const MemberPicker = ({
  labelledBy,
  members,
  meId,
  value,
  onChange,
}: MemberPickerProps): ReactElement => {
  const ordered = [
    ...members.filter((m) => m.id === meId),
    ...members.filter((m) => m.id !== meId),
  ];
  return (
    <RadioGroup.Root
      aria-labelledby={labelledBy}
      value={value ?? NOBODY}
      onValueChange={(next) => {
        onChange(next === NOBODY ? null : (members.find((m) => m.id === next)?.id ?? null));
      }}
      className="flex flex-wrap gap-2"
    >
      <RadioGroup.Item value={NOBODY} className={optionClass}>
        <span className="grid size-7 place-items-center rounded-full bg-slate-100 text-slate-500">
          <UserCircleIcon size={18} aria-hidden="true" />
        </span>
        Nobody
      </RadioGroup.Item>
      {ordered.map((m) => (
        <RadioGroup.Item key={m.id} value={m.id} className={optionClass}>
          <Avatar author={{ kind: "user", ...m }} size={28} decorative />
          {m.id === meId ? "Me" : m.name}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
};
