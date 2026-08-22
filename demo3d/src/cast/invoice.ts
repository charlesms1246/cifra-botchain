/* The invoice slab — PLAN.md §4.1. The protagonist.
   ─────────────────────────────────────────────────────────────────────────
   It is on stage in every scene and it carries the whole argument, so its
   state has to be readable from STATIC GEOMETRY AND PALETTE ALONE. Animation
   is a secondary cue, never the only one. (UI_3D_PLAN.md §5 step 1 makes the
   same demand of the app's SVG status marks, for the same reason: a viewer
   who catches one frame, or a projector that eats the colour, must still be
   able to tell "graded" from "funded".)

   The silhouette test, which is how these six were chosen — each differs in
   OUTLINE, before any colour:

     draft      fanned loose sheets      ragged, wider than the slab
     committed  one clean slab, banded   tight rectangle
     graded     + tab bolted top-right   rectangle with a lug
     funded     lifted clear of the floor  detached from its shadow
     settled    stamped                  rectangle with a mark on it
     defaulted  bottom-right corner torn off  broken rectangle + debris

   §7 rule 4 is enforced structurally here, not by discipline: the grade tab
   is not built with an empty texture and revealed later — `setGrade(null)`
   removes it from the scene. There is no letter to leak. */

import * as THREE from "three";
import { obox, softShadow, glowSprite } from "../voxel";
import { board, boardPlane, cardHead, displayText, figureText, rule } from "../board";
import { css, PAPER, INK, ACCENT, ACCENT_DEEP, SUCCESS, LOSS, GRADE_COLOR } from "../palette";
import { seg, eOutBack, eInCubic, lerp } from "../craft";

export type InvoiceState =
  | "draft" | "committed" | "graded" | "funded" | "settled" | "defaulted";

/* Slab dimensions, world units. A 1.5 x 2.1 face is roughly A-series
   proportion — it reads as a document rather than a card at every fov the
   deck uses. */
const W = 1.5;
const H = 2.1;
const T = 0.10;
/** Torn corner, bottom-right. Big enough to read in silhouette at fov 44. */
const C = 0.40;

const BAND_Y = 0.62;   // hash band sits above the tear zone, clear of it
const LIFT = 0.38;     // how far `funded` clears the floor

export interface InvoiceHandle {
  g: THREE.Group;
  setState(s: InvoiceState): void;
  state(): InvoiceState;
  setGrade(letter: string | null): void;
  grade(): string | null;
  /** Redraw the draft face and the commitment band. Used by S1, where a
   *  line item changes and the hash has to change with it. A REDRAW, never
   *  a tween — §7 rule 2 does not exempt hashes. */
  setDraft(o: { items?: LineItem[]; amount?: string; hash?: string; hot?: number }): void;
  /** Idle life. Pure function of t — a breath and, when funded, a float. */
  update(t: number): void;
}

export interface InvoiceOpts {
  items?: LineItem[];
  /** Face value shown on the draft, and on the total row. */
  amount?: string;
  buyer?: string;
  /** The commitment. Shown on the band from `committed` onward. */
  hash?: string;
  seed?: number;
}

/* ── the draft face: an actual invoice ────────────────────────────────── */

export type LineItem = [desc: string, amount: string];

const DEFAULT_ITEMS: LineItem[] = [
  ["Assembly, unit 4400-C", "18,400.00"],
  ["Finishing + QA", "6,250.00"],
  ["Freight, DDP", "1,830.00"],
];

function drawDraftFace(
  c: CanvasRenderingContext2D,
  o: { amount: string; buyer: string; items: LineItem[]; hot: number; hash: string },
): void {
  const w = 620, h = 868;
  c.fillStyle = css(PAPER);
  c.fillRect(0, 0, w, h);

  // masthead
  c.fillStyle = css(ACCENT);
  c.fillRect(0, 0, w, 10);
  displayText(c, 40, 92, "INVOICE", INK, 58);
  cardHead(c, 40, 124, "CIFRA · SUPPLIER COPY", ACCENT_DEEP, 15);

  // meta block. The buyer's NAME is on the supplier's own copy — that is the
  // point of scene S1: this face never leaves them.
  let y = 186;
  const meta: [string, string][] = [
    ["BUYER", o.buyer],
    ["TERMS", "NET 45"],
    ["ISSUED", "2026-08-04"],
  ];
  for (const [k, v] of meta) {
    cardHead(c, 40, y, k, ACCENT_DEEP, 14);
    figureText(c, w - 40, y, v, INK, 20, "700", "right");
    y += 38;
  }

  rule(c, 40, y + 6, w - 80, INK, 0.18);
  y += 54;

  // line items. `hot` marks the one S1 edits — a rule under it, nothing
  // more. A highlight box would read as a UI selection rather than as the
  // supplier changing a price.
  o.items.forEach(([d, a], i) => {
    const on = i === o.hot;
    figureText(c, 40, y, d, INK, 19, on ? "700" : "400");
    figureText(c, w - 40, y, a, on ? ACCENT_DEEP : INK, 19, on ? "700" : "400", "right");
    if (on) rule(c, 40, y + 9, w - 80, ACCENT, 0.9, 3);
    y += 40;
  });

  rule(c, 40, y + 2, w - 80, INK, 0.18);
  y += 62;
  cardHead(c, 40, y, "TOTAL DUE", ACCENT_DEEP, 16);
  figureText(c, w - 40, y + 6, o.amount, INK, 42, "700", "right");

  /* Footer. The commitment is on the OPEN document, not only on the sealed
     one — S1's whole first act is "change a line and the hash changes", and
     the hash has to be on screen while the page is still readable for that
     to be shown rather than asserted. */
  cardHead(c, 40, h - 92, "STAYS WITH THE SUPPLIER", ACCENT_DEEP, 13);
  c.fillStyle = css(ACCENT);
  c.fillRect(28, h - 74, w - 56, 50);
  cardHead(c, 40, h - 54, "COMMITMENT", INK, 12);
  figureText(c, w - 40, h - 38, o.hash, PAPER, 24, "700", "right");
}

/* ── the hash chip that rides on the band ─────────────────────────────── */

function drawHash(c: CanvasRenderingContext2D, hash: string, tint: number): void {
  const w = 560, h = 74;
  c.clearRect(0, 0, w, h);
  cardHead(c, 6, 26, "COMMITMENT", tint, 15);
  figureText(c, 6, 62, hash, PAPER, 26, "700");
}

function drawGrade(c: CanvasRenderingContext2D, letter: string): void {
  const s = 220;
  c.clearRect(0, 0, s, s);
  const col = GRADE_COLOR[letter] ?? ACCENT;
  c.fillStyle = css(INK);
  c.fillRect(0, 0, s, s);
  c.strokeStyle = css(col);
  c.lineWidth = 8;
  c.strokeRect(4, 4, s - 8, s - 8);
  displayText(c, s / 2, s / 2 + 46, letter, col, 132, "700", "center");
}

/* ── the slab ─────────────────────────────────────────────────────────── */

export function makeInvoice(parent: THREE.Object3D, opts: InvoiceOpts = {}): InvoiceHandle {
  let amount = opts.amount ?? "26,480.00";
  const buyer = opts.buyer ?? "ACME CORP";
  let hash = opts.hash ?? "0x8f2c…41ab";
  let items: LineItem[] = opts.items ?? DEFAULT_ITEMS;
  let hot = -1;

  const g = new THREE.Group();
  parent.add(g);

  const shadow = softShadow(g, 2.6, 0.34);

  /* `body` carries every part of the slab. States move THIS, so the shadow
     stays on the floor and the lift in `funded` actually opens a gap. */
  const body = new THREE.Group();
  g.add(body);

  /* -- draft fan: loose sheets behind the top one ---------------------- */
  const fan = new THREE.Group();
  body.add(fan);
  const FAN = [
    { rz: 0.055, x: -0.10, z: -0.05 },
    { rz: -0.038, x: 0.09, z: -0.10 },
    { rz: 0.021, x: -0.03, z: -0.15 },
  ];
  for (const f of FAN) {
    obox(fan, W, H, 0.025, PAPER, f.x, H / 2, f.z, {
      rz: f.rz, outlineThickness: 0.045,
    });
  }

  /* -- the slab, in two variants ---------------------------------------
     A box cannot be notched, so `defaulted` needs a slab composed of pieces
     with the bottom-right corner separable. But every piece carries its own
     ink outline, and abutting outlines draw a seam straight across the face
     — which showed up on the first cast sheet as a phantom rectangle on
     every intact slab.

     So: ONE whole box for the five intact states, and a broken variant
     swapped in only for `defaulted`, where the seam is exactly what you
     want to see. Duplicate geometry is the cheap side of this trade. */
  const slabWhole = obox(body, W, H, T, PAPER, 0, H / 2, 0, { outlineThickness: 0.055 });

  const broken = new THREE.Group();
  broken.visible = false;
  body.add(broken);
  const mainH = H - C;
  obox(broken, W, mainH, T, PAPER, 0, C + mainH / 2, 0, { outlineThickness: 0.055 });
  obox(broken, W - C, C, T, PAPER, -C / 2, C / 2, 0, { outlineThickness: 0.055 });

  const corner = new THREE.Group();
  broken.add(corner);
  obox(corner, C, C, T, PAPER, W / 2 - C / 2, C / 2, 0, { outlineThickness: 0.055 });
  /* The torn edge. A raw red seam is what says "torn" rather than "a piece
     was removed neatly". */
  const tornEdge = obox(broken, C, 0.06, T * 1.04, LOSS, W / 2 - C / 2, C, 0, {
    outline: false,
  });

  /* -- draft face: the invoice itself ---------------------------------- */
  const draftBoard = board(620, 868, (c) => drawDraftFace(c, { amount, buyer, items, hot, hash }));
  const draftFace = boardPlane(draftBoard, W - 0.06, H - 0.06, {
    transparent: false, renderOrder: 2,
  });
  draftFace.position.set(0, H / 2, T / 2 + 0.004);
  body.add(draftFace);

  /* -- sealed: a wax-seal block + the commitment band ------------------
     Deliberately GEOMETRY, not a texture. A sealed invoice has nothing to
     read, and building it from parts means the torn corner works without
     a full-face plane fighting it. */
  const sealed = new THREE.Group();
  body.add(sealed);
  obox(sealed, 0.30, 0.30, 0.05, ACCENT_DEEP, 0, H - 0.42, T / 2 + 0.02, {
    rz: Math.PI / 4, outlineThickness: 0.028,
  });
  obox(sealed, 0.14, 0.14, 0.02, ACCENT, 0, H - 0.42, T / 2 + 0.055, {
    rz: Math.PI / 4, outlineThickness: 0.02,
  });

  const band = obox(sealed, W * 0.94, 0.20, 0.04, ACCENT, 0, BAND_Y, T / 2 + 0.018, {
    outlineThickness: 0.026,
  });
  const bandMat = band.material as THREE.MeshToonMaterial;

  const hashBoard = board(560, 74, (c) => drawHash(c, hash, ACCENT_DEEP));
  const hashPlane = boardPlane(hashBoard, W * 0.80, 0.155, { renderOrder: 3 });
  hashPlane.position.set(0, BAND_Y, T / 2 + 0.045);
  sealed.add(hashPlane);

  /* -- grade tab: built on demand, removed when there is no grade ------ */
  let tab: THREE.Group | null = null;
  let tabBoard: ReturnType<typeof board> | null = null;
  let gradeLetter: string | null = null;

  function buildTab(letter: string): void {
    if (!tab) {
      tab = new THREE.Group();
      body.add(tab);
      const col = GRADE_COLOR[letter] ?? ACCENT;
      // Juts PAST the slab edge so it breaks the silhouette — a tab flush
      // with the face would be invisible in outline, which fails the test
      // this whole cast is built around.
      obox(tab, 0.52, 0.52, T + 0.06, col, W / 2 - 0.02, H - 0.34, 0, {
        outlineThickness: 0.03,
      });
      tabBoard = board(220, 220, (c) => drawGrade(c, letter));
      const p = boardPlane(tabBoard, 0.46, 0.46, { renderOrder: 4 });
      p.position.set(W / 2 - 0.02, H - 0.34, (T + 0.06) / 2 + 0.004);
      tab.add(p);
    } else {
      const col = GRADE_COLOR[letter] ?? ACCENT;
      const lug = tab.children[0] as THREE.Mesh;
      (lug.material as THREE.MeshToonMaterial).color.setHex(col);
      tabBoard?.redraw((c) => drawGrade(c, letter));
    }
    tab.visible = true;
  }

  /* -- settled stamp ---------------------------------------------------
     GEOMETRY, not a painted tick. The first cast sheet drew this as a
     stroked mark on a board, and it failed the grayscale test outright:
     desaturated, a light green stroke on light paper is invisible and
     `settled` was indistinguishable from `graded`. A raised, outlined tick
     survives the test because it has its own silhouette and its own ink
     edge — which is the whole reason §4.1 demands geometry first. */
  const stamp = new THREE.Group();
  stamp.position.set(0, H * 0.50, T / 2 + 0.05);
  body.add(stamp);
  obox(stamp, 0.34, 0.13, 0.10, SUCCESS, -0.15, -0.09, 0, {
    rz: -0.85, outlineThickness: 0.05,
  });
  obox(stamp, 0.66, 0.13, 0.10, SUCCESS, 0.14, 0.09, 0, {
    rz: 0.95, outlineThickness: 0.05,
  });

  /* -- funded underlight ----------------------------------------------- */
  const underglow = glowSprite(ACCENT, 2.2, 0.0);
  underglow.position.set(0, 0.10, 0);
  g.add(underglow);

  /* ── state ─────────────────────────────────────────────────────────── */
  let st: InvoiceState = "draft";
  /* The scene-local time at which the current state was entered, so the
     transition into it can be expressed as a function of t. Set by the
     caller through setState at a known beat — never read from a clock. */
  let enteredAt = 0;
  let lastT = 0;

  function apply(): void {
    const sealedStates = st !== "draft";
    fan.visible = st === "draft";
    draftFace.visible = st === "draft";
    sealed.visible = sealedStates;
    stamp.visible = st === "settled";
    slabWhole.visible = st !== "defaulted";
    broken.visible = st === "defaulted";
    tornEdge.visible = st === "defaulted";
    if (tab) tab.visible = gradeLetter !== null && st !== "draft" && st !== "committed";

    // The band is the state's colour of record — it is the one element
    // present in every sealed state, so it is where the palette cue lives.
    bandMat.color.setHex(
      st === "settled" ? SUCCESS : st === "defaulted" ? LOSS : ACCENT,
    );
    hashBoard.redraw((c) =>
      drawHash(c, hash, st === "settled" ? INK : st === "defaulted" ? INK : ACCENT_DEEP),
    );
  }

  apply();

  const handle: InvoiceHandle = {
    g,
    state: () => st,
    grade: () => gradeLetter,
    setState(next) {
      if (next === st) return;
      st = next;
      enteredAt = lastT;
      apply();
    },
    setDraft(o) {
      if (o.items) items = o.items;
      if (o.amount !== undefined) amount = o.amount;
      if (o.hash !== undefined) hash = o.hash;
      if (o.hot !== undefined) hot = o.hot;
      draftBoard.redraw((c) => drawDraftFace(c, { amount, buyer, items, hot, hash }));
      apply();
    },
    setGrade(letter) {
      gradeLetter = letter;
      if (letter === null) {
        // Remove it outright. §7 rule 4: there must be no letter in the
        // scene to leak, not merely a hidden one.
        if (tab) { body.remove(tab); tab = null; tabBoard?.dispose(); tabBoard = null; }
      } else {
        buildTab(letter);
      }
      apply();
    },
    update(t) {
      lastT = t;
      const since = t - enteredAt;

      // Breath. Tiny — a document is not alive, it just is not dead.
      const breathe = Math.sin(t * 1.15) * 0.008;

      if (st === "funded") {
        // Lifts clear of the floor and hangs. eOutBack so it arrives with a
        // little overshoot instead of gliding to a halt.
        const rise = eOutBack(seg(since, 0, 0.75));
        const float = Math.sin(t * 0.9) * 0.035;
        body.position.y = LIFT * rise + float + breathe;
        body.rotation.z = Math.sin(t * 0.62) * 0.012;
        shadow.scale.setScalar(lerp(1, 0.72, rise));
        (shadow.material as THREE.MeshBasicMaterial).opacity = lerp(0.34, 0.20, rise);
        underglow.material.opacity = 0.42 * rise;
      } else {
        body.position.y = breathe;
        body.rotation.z = 0;
        shadow.scale.setScalar(1);
        (shadow.material as THREE.MeshBasicMaterial).opacity = 0.34;
        underglow.material.opacity = 0;
      }

      if (st === "defaulted") {
        /* The corner tears off and falls to the floor beside the slab.
           eInCubic on the way down (it accelerates), and it keeps turning
           for a beat after it lands — follow-through, CRAFT.md: nothing in a
           body stops on the same frame as the body.

           It comes to rest lying flat AT y=0, not below it. The first pass
           dropped it 1.16 units and it went through the stage. */
        const p = seg(since, 0, 0.9);
        const fall = eInCubic(p);
        const rest = -(C / 2) + T / 2;          // centre height once flat
        corner.position.set(0.44 * fall, rest * fall, 0.26 * fall);
        corner.rotation.z = -Math.PI / 2 * fall - 0.14 * Math.sin(seg(since, 0.9, 1.6) * Math.PI);
        corner.rotation.x = -Math.PI / 2 * fall;
      } else {
        corner.position.set(0, 0, 0);
        corner.rotation.set(0, 0, 0);
      }
    },
  };

  return handle;
}
