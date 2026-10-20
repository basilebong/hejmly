const PALETTE = [
  { bg: "#e2e8f0", fg: "#334155" },
  { bg: "#fef3c7", fg: "#92400e" },
  { bg: "#e0f2fe", fg: "#075985" },
  { bg: "#d1fae5", fg: "#065f46" },
  { bg: "#ede9fe", fg: "#5b21b6" },
  { bg: "#ffe4e6", fg: "#9f1239" },
  { bg: "#fef9c3", fg: "#854d0e" },
  { bg: "#cffafe", fg: "#155e75" },
] as const;

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

export type AvatarPalette = (typeof PALETTE)[number];

export const paletteFor = (key: string): AvatarPalette => {
  const slot = PALETTE[hash(key) % PALETTE.length];
  return slot ?? PALETTE[0];
};
