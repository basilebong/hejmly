export const blankToNull = (value: string | null): string | null =>
  value === null || value.trim().length === 0 ? null : value;
