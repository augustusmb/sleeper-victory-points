/** Whole numbers stay whole; the "average" tie rule can introduce halves. */
export const formatVp = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

/** No thousands separator, matching the format the league already reads. */
export const formatPf = (n: number): string => n.toFixed(2);

export const formatScore = (n: number): string => n.toFixed(2);
