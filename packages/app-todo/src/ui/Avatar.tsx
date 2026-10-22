import type { ReactElement } from "react";
import type { TodoAuthor } from "../shared/index.ts";
import { paletteFor } from "./colors.ts";

type AvatarProps = {
  author: TodoAuthor;
  label?: string;
  size?: number;
  decorative?: boolean;
};

const paletteKey = (author: TodoAuthor): string =>
  author.kind === "user" ? author.id : `unknown:${author.name}`;

export const Avatar = ({
  author,
  label,
  size = 24,
  decorative = false,
}: AvatarProps): ReactElement => {
  const palette = paletteFor(paletteKey(author));
  const a11y = decorative
    ? { "aria-hidden": true }
    : { role: "img", "aria-label": label ?? `Added by ${author.name}`, title: author.name };
  return (
    <div
      {...a11y}
      className="grid shrink-0 place-items-center rounded-full font-semibold text-[10px]"
      style={{ width: size, height: size, background: palette.bg, color: palette.fg }}
    >
      <span aria-hidden="true">{author.initial}</span>
    </div>
  );
};
