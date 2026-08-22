/* The deck palette — PLAN.md §3, single source.
   Matches frontend/app/globals.css so the deck and the recorded app segment
   read as one piece. Hex ints for three.js; the `css` mirror is for the
   canvas-texture boards in board.ts, which take strings. */

export const BG           = 0x0b0908; // near-black, faint warm cast
export const INK          = 0x120e0d; // outline on every solid
export const PAPER        = 0xf6f1ee; // type, invoice stock

export const ACCENT       = 0xde7356; // Cifra terracotta  (--brand)
export const ACCENT_DEEP  = 0xb14e30; // shadowed accent   (--brand-600)
export const ACCENT_LIGHT = 0xf0a488; // lit accent        (--brand-300)

export const SUCCESS      = 0x5bbf8f; // confirmed · settled · senior intact
export const WARNING      = 0xe0a92a; // exposure · caveat
export const LOSS         = 0xd2452f; // default · junior wiped

/* Neutrals. The room, the vault shells and the figures live here — nothing
   structural competes with the accent, which is reserved for the invoice,
   the grade and Cifra itself. */
export const STEEL        = 0x3a3330;
export const STEEL_DARK   = 0x241f1d;
export const STEEL_LIGHT  = 0x6b615c;

export const css = (hex: number, alpha = 1): string => {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
};

/* Grade colours. Deliberately NOT a red-to-green ramp: a D is a wider spread,
   not a failure, and colouring it like one would misstate the product. A and B
   sit in the accent family, C and D shade toward warning. */
export const GRADE_COLOR: Record<string, number> = {
  A: SUCCESS,
  B: ACCENT_LIGHT,
  C: ACCENT,
  D: WARNING,
};
