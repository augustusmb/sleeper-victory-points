/**
 * Render the standings card straight onto a canvas and put it on the
 * clipboard, so posting to the group chat doesn't involve a crop.
 *
 * Drawn by hand rather than via an HTML-to-canvas library: team names contain
 * emoji (which SVG/foreignObject rasterizers drop), and this draws at 2x so
 * the numbers survive chat recompression.
 */

export interface ImageRow {
  rank: number;
  team: string;
  vp: string;
  pf: string;
  /** 0-1, width of the proportional bar. */
  barPct: number;
}

export interface ImageSpec {
  title: string;
  subtitle: string;
  rows: ImageRow[];
  footnotes: string[];
}

const SCALE = 2;

const L = {
  width: 760,
  padX: 32,
  padTop: 28,
  padBottom: 22,
  rowHeight: 50,
  headerHeight: 24,
  colRank: 44,
  colVp: 78,
  colBar: 150,
  colPf: 112,
  gutter: 14,
};

const C = {
  card: "#141922",
  edge: "#232b38",
  rowAlt: "#1a202b",
  text: "#eef2f8",
  muted: "#8d9bb0",
  dim: "#5f6b7d",
  accent: "#4ade80",
  accentDim: "#1f3d2b",
};

const FONT =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`;

/** Trim with an ellipsis to fit `maxWidth`. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

/** Greedy word wrap; unlike `fit` it keeps the whole string. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, value: string) {
  // Not in every engine; harmless to skip where unsupported.
  if ("letterSpacing" in ctx) ctx.letterSpacing = value;
}

/**
 * Fit the title into the card: one line if it can, otherwise two, shrinking
 * the type only once wrapping alone isn't enough. League names come from
 * Sleeper and can be renamed at any time, so the card can't assume a length.
 */
function layoutTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
  maxWidth: number,
): { lines: string[]; size: number } {
  const words = title.split(" ");

  for (const size of [30, 27, 24, 22, 20]) {
    ctx.font = font(800, size);
    if (ctx.measureText(title).width <= maxWidth) return { lines: [title], size };

    // Greedy two-line wrap, keeping the first line as full as it can be.
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);

    if (lines.length <= 2 && lines.every((l) => ctx.measureText(l).width <= maxWidth)) {
      return { lines, size };
    }
  }

  // Nothing fit; fall back to a single ellipsized line at the smallest size.
  ctx.font = font(800, 20);
  return { lines: [fit(ctx, title, maxWidth)], size: 20 };
}

export function renderStandingsImage(spec: ImageSpec): HTMLCanvasElement {
  // Measuring needs a context, so lay the text out on a throwaway one before
  // the real canvas is sized.
  const probe = document.createElement("canvas").getContext("2d")!;
  const innerW = L.width - L.padX * 2;
  const titleLayout = layoutTitle(probe, spec.title, innerW);

  probe.font = font(500, 12.5);
  const footLines = spec.footnotes.flatMap((note) => wrap(probe, note, innerW));
  const footHeight = footLines.length ? 14 + footLines.length * 18 + 4 : 0;
  const titleLineHeight = Math.round(titleLayout.size * 1.18);
  const titleHeight = titleLayout.lines.length * titleLineHeight;

  const tableTop = L.padTop + titleHeight + 7 + 19 + 22;
  const height =
    tableTop +
    L.headerHeight +
    spec.rows.length * L.rowHeight +
    footHeight +
    L.padBottom;

  const canvas = document.createElement("canvas");
  canvas.width = L.width * SCALE;
  canvas.height = Math.round(height) * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "top";

  // card
  ctx.fillStyle = C.card;
  ctx.beginPath();
  ctx.roundRect(0, 0, L.width, height, 14);
  ctx.fill();
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 1;
  ctx.stroke();

  const left = L.padX;
  const right = L.width - L.padX;
  const innerWidth = right - left;

  // header
  ctx.fillStyle = C.text;
  ctx.font = font(800, titleLayout.size);
  ctx.textAlign = "left";
  titleLayout.lines.forEach((line, i) => {
    ctx.fillText(line, left, L.padTop + i * titleLineHeight);
  });

  ctx.fillStyle = C.muted;
  ctx.font = font(500, 15);
  ctx.fillText(
    fit(ctx, spec.subtitle, innerWidth),
    left,
    L.padTop + titleHeight + 7,
  );

  // column x positions, mirroring the CSS grid
  const xRankRight = left + L.colRank;
  const xTeam = xRankRight + L.gutter;
  const xPfRight = right;
  const xBarRight = xPfRight - L.colPf;
  const xBarLeft = xBarRight - L.colBar;
  const xVpRight = xBarLeft - L.gutter;
  const teamWidth = xVpRight - L.colVp - xTeam - L.gutter;

  // column headings
  let y = tableTop;
  ctx.font = font(700, 11);
  ctx.fillStyle = C.dim;
  setLetterSpacing(ctx, "0.09em");
  ctx.textAlign = "right";
  ctx.fillText("#", xRankRight, y);
  ctx.textAlign = "left";
  ctx.fillText("TEAM", xTeam, y);
  ctx.textAlign = "right";
  ctx.fillText("VP", xVpRight, y);
  ctx.fillText("TOTAL PF", xPfRight, y);
  setLetterSpacing(ctx, "0px");

  y += L.headerHeight;
  ctx.strokeStyle = C.edge;
  ctx.beginPath();
  ctx.moveTo(left, y - 0.5);
  ctx.lineTo(right, y - 0.5);
  ctx.stroke();

  // rows
  spec.rows.forEach((row, i) => {
    const top = y + i * L.rowHeight;
    const mid = top + L.rowHeight / 2;

    if (i % 2 === 1) {
      ctx.fillStyle = C.rowAlt;
      ctx.fillRect(left - 6, top, innerWidth + 12, L.rowHeight);
    }

    if (i < spec.rows.length - 1) {
      ctx.strokeStyle = "rgba(35,43,56,0.55)";
      ctx.beginPath();
      ctx.moveTo(left - 6, top + L.rowHeight - 0.5);
      ctx.lineTo(right + 6, top + L.rowHeight - 0.5);
      ctx.stroke();
    }

    ctx.textBaseline = "middle";

    ctx.font = font(600, 15);
    ctx.fillStyle = C.dim;
    ctx.textAlign = "right";
    ctx.fillText(String(row.rank), xRankRight, mid);

    ctx.font = font(600, 18);
    ctx.fillStyle = C.text;
    ctx.textAlign = "left";
    ctx.fillText(fit(ctx, row.team, teamWidth), xTeam, mid);

    ctx.font = font(800, 26);
    ctx.fillStyle = C.text;
    ctx.textAlign = "right";
    ctx.fillText(row.vp, xVpRight, mid);

    const barH = 8;
    ctx.fillStyle = C.accentDim;
    ctx.beginPath();
    ctx.roundRect(xBarLeft, mid - barH / 2, L.colBar, barH, 4);
    ctx.fill();
    const fillW = Math.max(0, Math.min(1, row.barPct)) * L.colBar;
    if (fillW > 0) {
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.roundRect(xBarLeft, mid - barH / 2, Math.max(fillW, barH), barH, 4);
      ctx.fill();
    }

    ctx.font = font(600, 18);
    ctx.fillStyle = C.muted;
    ctx.textAlign = "right";
    ctx.fillText(row.pf, xPfRight, mid);

    ctx.textBaseline = "top";
  });

  // footnotes
  if (footLines.length) {
    let fy = y + spec.rows.length * L.rowHeight + 14;
    ctx.strokeStyle = C.edge;
    ctx.beginPath();
    ctx.moveTo(left, fy - 7.5);
    ctx.lineTo(right, fy - 7.5);
    ctx.stroke();

    ctx.font = font(500, 12.5);
    ctx.fillStyle = C.dim;
    ctx.textAlign = "left";
    for (const line of footLines) {
      ctx.fillText(line, left, fy);
      fy += 18;
    }
  }

  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
      "image/png",
    ),
  );

export type CopyOutcome = "copied" | "downloaded";

/**
 * `navigator.clipboard.write` can hang indefinitely rather than reject when
 * the document doesn't hold OS focus, which would strand the button on
 * "Rendering…". Bound it and fall back to a download instead.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("clipboard write timed out")),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Write the PNG to the clipboard, falling back to a file download where the
 * async clipboard image API isn't available (Firefox, non-secure contexts).
 */
export async function copyStandingsImage(
  spec: ImageSpec,
  filename: string,
): Promise<CopyOutcome> {
  const blob = await toBlob(renderStandingsImage(spec));

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await withTimeout(
        navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]),
        4000,
      );
      return "copied";
    } catch {
      // fall through to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
