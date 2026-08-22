/* Canvas-texture cards — every word and figure in the deck.
   ─────────────────────────────────────────────────────────────────────────
   The idiom is lifted from reference/meld/demo/parts/problem.js:118-150:
   draw into an offscreen canvas, wrap it in a CanvasTexture, map it onto a
   plane or a sprite. Text-as-geometry (TextGeometry) is the alternative and
   it is worse in every way that matters here — it needs a font loader, it
   triangulates badly at small sizes, and it cannot do a card frame.

   All type is drawn at 2-4x its on-screen size and minified down, which is
   what keeps it crisp under the capture's downscale.

   FIGURES ARE ALWAYS MONO. JetBrains Mono is monospaced, so its digits are
   tabular by construction — a column of numbers lines up and a changing
   figure does not reflow the words around it. PLAN.md §3. */

import * as THREE from "three";
import { css, INK, PAPER, ACCENT } from "./palette";
import { DISPLAY, MONO } from "./fonts";

export interface Board {
  tex: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Re-run a draw callback and flag the texture. The ONLY way the deck is
   *  allowed to change text at runtime — and note §7 rule 2: a redraw shows
   *  a new value, it never tweens toward one. */
  redraw(draw: (c: CanvasRenderingContext2D) => void): void;
  dispose(): void;
}

export function board(
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D) => void,
): Board {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return {
    tex, canvas, ctx,
    redraw(fn) {
      ctx.clearRect(0, 0, w, h);
      fn(ctx);
      tex.needsUpdate = true;
    },
    dispose() { tex.dispose(); },
  };
}

/** A board mounted on a plane, sized in world units. `transparent` keeps the
 *  card's own alpha, so a frame can sit over geometry without a black box
 *  around it. */
export function boardPlane(
  b: Board,
  worldW: number,
  worldH: number,
  opts: { transparent?: boolean; renderOrder?: number } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(worldW, worldH),
    new THREE.MeshBasicMaterial({
      map: b.tex,
      transparent: opts.transparent ?? true,
      /* An OPAQUE board must write depth. It was hardcoded false here, and
         on S6 — the first scene to stand large opaque panels in front of the
         backdrop — the skyline rendered straight through all three of them.
         Transparent boards still skip the depth write, which is what keeps
         overlapping labels from punching holes in each other. */
      depthWrite: !(opts.transparent ?? true),
      toneMapped: false,
    }),
  );
  if (opts.renderOrder !== undefined) m.renderOrder = opts.renderOrder;
  return m;
}

/* ── card chrome ──────────────────────────────────────────────────────── */

export interface Area { x: number; y: number; r: number; b: number; w: number; h: number }

export interface FrameOpts {
  accent?: number;
  /** Card stock. Default is ink — a dark card on a dark stage, held apart by
   *  its accent border. Pass PAPER for a light card (the invoice face). */
  fill?: number;
  pad?: number;
  /** Height of the coloured bar across the top. 0 for none. */
  bar?: number;
  border?: number;
}

/** Draw a card frame and return the inner content area.
 *
 *  One border width, one bar height, one pad — meld's ui-research-craft.md
 *  is blunt that the fastest way to make a deck look amateur is three of
 *  each. Callers pass `pad` and nothing else, almost always. */
export function cardFrame(
  c: CanvasRenderingContext2D,
  w: number, h: number,
  opts: FrameOpts = {},
): Area {
  const { accent = ACCENT, fill = INK, pad = 24, bar = 0, border = 4 } = opts;

  c.fillStyle = css(fill);
  c.fillRect(0, 0, w, h);

  if (bar > 0) {
    c.fillStyle = css(accent);
    c.fillRect(0, 0, w, bar);
  }

  c.strokeStyle = css(accent);
  c.lineWidth = border;
  c.strokeRect(border / 2, border / 2, w - border, h - border);

  const top = Math.max(bar, border) + pad;
  return { x: pad, y: top, r: w - pad, b: h - pad, w: w - pad * 2, h: h - top - pad };
}

/** Width `cardHead` will actually occupy. Canvas has no letter-spacing, so
 *  cardHead draws per character and adds tracking between them — meaning
 *  `measureText` UNDERSTATES it by roughly the tracking fraction. Any code
 *  wrapping text to a width must measure with this, not with measureText.
 *  (S6's caveat panel wrapped with the raw measurement and clipped "ONE
 *  PERSON" to "ON PERSON" — a caveat truncated into a different sentence.) */
export function measureHead(
  c: CanvasRenderingContext2D,
  text: string,
  size = 22,
  tracking = 0.18,
): number {
  c.font = `bold ${size}px '${MONO}', monospace`;
  let w = 0;
  for (const ch of text.toUpperCase()) w += c.measureText(ch).width + size * tracking;
  return w;
}

/** A small uppercase label with wide tracking — the deck's only heading
 *  style. Canvas has no letter-spacing, so it is drawn per character. */
export function cardHead(
  c: CanvasRenderingContext2D,
  x: number, y: number,
  text: string,
  color = ACCENT,
  size = 22,
  tracking = 0.18,
): number {
  c.fillStyle = css(color);
  c.font = `bold ${size}px '${MONO}', monospace`;
  c.textAlign = "left";
  c.textBaseline = "alphabetic";
  let cx = x;
  for (const ch of text.toUpperCase()) {
    c.fillText(ch, cx, y);
    cx += c.measureText(ch).width + size * tracking;
  }
  return cx - x;
}

/** Display type — the face the app uses. Titles only; never figures. */
export function displayText(
  c: CanvasRenderingContext2D,
  x: number, y: number,
  text: string,
  color = PAPER,
  size = 48,
  weight: "400" | "700" = "700",
  align: CanvasTextAlign = "left",
): void {
  c.fillStyle = css(color);
  c.font = `${weight} ${size}px '${DISPLAY}', ui-sans-serif, sans-serif`;
  c.textAlign = align;
  c.textBaseline = "alphabetic";
  c.fillText(text, x, y);
}

/** A figure. Mono, therefore tabular. Everything numeric goes through here. */
export function figureText(
  c: CanvasRenderingContext2D,
  x: number, y: number,
  text: string,
  color = PAPER,
  size = 40,
  weight: "400" | "700" = "700",
  align: CanvasTextAlign = "left",
): void {
  c.fillStyle = css(color);
  c.font = `${weight} ${size}px '${MONO}', monospace`;
  c.textAlign = align;
  c.textBaseline = "alphabetic";
  c.fillText(text, x, y);
}

/** Wrap `text` to `maxWidth` under cardHead's metrics. Returns the lines. */
export function wrapHead(
  c: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size = 15,
  tracking = 0.18,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (cur && measureHead(c, test, size, tracking) > maxWidth) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** A hairline rule. */
export function rule(
  c: CanvasRenderingContext2D,
  x: number, y: number, w: number,
  color = ACCENT, alpha = 0.35, thickness = 2,
): void {
  c.fillStyle = css(color, alpha);
  c.fillRect(x, y, w, thickness);
}
