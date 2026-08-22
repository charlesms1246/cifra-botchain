/* The two basins — PLAN.md §4.3. The waterfall asset.
   ─────────────────────────────────────────────────────────────────────────
   One pool, two share classes, STACKED: junior below, senior above. The
   geometry states the subordination before anything moves — loss drains
   from the bottom, and the senior basin cannot be reached until the junior
   one is empty. That arrangement is the argument; the animation only plays
   it out.

   §7 rules 2 and 3 are load-bearing here. A fill level is a claim about
   money. `setSenior`/`setJunior` SET a level — they do not tween toward one,
   and this asset owns no easing of its own. A scene moves a level at the
   beat that moved the money, or it does not move it. There is deliberately
   no `animateTo()` on this handle for anyone to reach for. */

import * as THREE from "three";
import { obox, flat } from "../voxel";
import { board, boardPlane, cardHead, figureText } from "../board";
import { css, INK, PAPER, ACCENT, ACCENT_DEEP, ACCENT_LIGHT, SUCCESS, LOSS, STEEL, STEEL_DARK, STEEL_LIGHT } from "../palette";
import { clamp } from "../craft";
import { drawBotChain } from "../assets";

const BW = 3.6;    // basin width
const BD = 1.9;    // basin depth
const BH = 1.15;   // basin inner height
const WALL = 0.13;
const GAP = 0.55;  // vertical gap between the two tanks

const JUNIOR_Y = 0.30;
const SENIOR_Y = JUNIOR_Y + BH + GAP + 0.28;

export type Tranche = "senior" | "junior";

export interface BasinsHandle {
  g: THREE.Group;
  /** Set a level, 0..1. Not a tween. See the header. */
  setLevel(which: Tranche, level: number): void;
  level(which: Tranche): number;
  /** Recolour a tranche to mark it wiped. Junior only, in practice. */
  setWiped(which: Tranche, wiped: boolean): void;
  update(t: number): void;
}

export interface BasinsOpts {
  /** "BOT" or "USDT" — an invoice is faced, funded and repaid in one book. */
  book?: string;
  /** Which side of the rig the tranche plates hang on. Default right (+1). */
  plateSide?: -1 | 1;
}

function tank(
  parent: THREE.Object3D,
  y: number,
  shellColor: number,
): { fill: THREE.Mesh; fillMat: THREE.MeshBasicMaterial } {
  // floor
  obox(parent, BW, WALL, BD, shellColor, 0, y, 0, { outlineThickness: 0.06 });
  // side walls — left/right/back only. The FRONT is left open so the fill
  // level is legible head-on; a closed tank would need a transparent face
  // and transparency in a toon scene reads as a bug.
  obox(parent, WALL, BH, BD, shellColor, -BW / 2 + WALL / 2, y + BH / 2, 0, { outlineThickness: 0.06 });
  obox(parent, WALL, BH, BD, shellColor, BW / 2 - WALL / 2, y + BH / 2, 0, { outlineThickness: 0.06 });
  obox(parent, BW, BH, WALL, shellColor, 0, y + BH / 2, -BD / 2 + WALL / 2, { outlineThickness: 0.06 });
  // a low front lip, so the tank has a bottom edge and the fill sits IN it
  obox(parent, BW, 0.16, WALL, shellColor, 0, y + 0.08, BD / 2 - WALL / 2, { outlineThickness: 0.06 });

  /* The fill. Unlit flat material: a fill is a quantity, not a surface, and
     toon-shading it makes the level read differently depending on which way
     the tank faces the key. */
  const fillMat = flat(ACCENT);
  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(BW - WALL * 2, 1, BD - WALL * 2),
    fillMat,
  );
  // Anchor the box at its BASE so scale.y is the level directly — the
  // alternative (scale + reposition every frame) is where off-by-half bugs
  // in a fill level come from.
  fill.geometry.translate(0, 0.5, 0);
  fill.position.set(0, y + WALL / 2, 0);
  fill.scale.y = 0.0001;
  parent.add(fill);
  return { fill, fillMat };
}

function plate(text: string, sub: string, accent: number): THREE.Mesh {
  const b = board(560, 150, (c) => {
    c.fillStyle = css(INK);
    c.fillRect(0, 0, 560, 150);
    c.strokeStyle = css(accent);
    c.lineWidth = 5;
    c.strokeRect(2.5, 2.5, 555, 145);
    c.fillStyle = css(accent);
    c.fillRect(0, 0, 560, 9);
    cardHead(c, 24, 62, text, accent, 30);
    cardHead(c, 24, 108, sub, PAPER, 18);
  });
  return boardPlane(b, 1.55, 1.55 * 150 / 560, { transparent: false, renderOrder: 4 });
}

export function makeBasins(parent: THREE.Object3D, opts: BasinsOpts = {}): BasinsHandle {
  const bookLabel = opts.book ?? "BOT";
  const ps = opts.plateSide ?? 1;
  const g = new THREE.Group();
  parent.add(g);

  /* -- frame: four posts, so the two tanks read as ONE structure ---------
     Without them they look like two unrelated boxes, and the whole point is
     that this is one pool with two claims on it. */
  const postH = SENIOR_Y + BH + 0.5;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      obox(g, 0.16, postH, 0.16, STEEL_DARK,
        sx * (BW / 2 + 0.12), postH / 2, sz * (BD / 2 + 0.06),
        { outlineThickness: 0.055 });
    }
  }
  obox(g, BW + 0.6, 0.18, BD + 0.5, STEEL_DARK, 0, 0.09, 0, { outlineThickness: 0.06 });

  const senior = tank(g, SENIOR_Y, STEEL_LIGHT);
  const junior = tank(g, JUNIOR_Y, STEEL);

  /* The subordination pipe: senior sits ON junior's shoulders. A short
     column between them, so the stack is visibly load-bearing rather than
     two shelves. */
  obox(g, 0.42, GAP + 0.28, 0.42, STEEL_DARK, 0, JUNIOR_Y + BH + (GAP + 0.28) / 2, 0, {
    outlineThickness: 0.055,
  });

  /* Senior is the LIGHTER fill, junior the hot one. The first pass had it
     the other way round and senior's capital read as shadow — which is
     exactly backwards for the tranche the deck spends S5 proving is safe. */
  senior.fillMat.color.setHex(ACCENT_LIGHT);
  junior.fillMat.color.setHex(ACCENT);

  const sp = plate("SENIOR", "PROTECTED · 50% OF YIELD", SUCCESS);
  /* Plates on the RIGHT of the rig by default. The caption block is always
     top-LEFT (§3), and on the crane that frames both tanks the left-hand
     plates landed straight on the scene's own title.
     `plateSide` exists because S4 stands two rigs either side of the stage
     and puts figures in the middle: there, the labels have to hang on the
     OUTSIDE or they are exactly where the funders stand. */
  sp.position.set(ps * (BW / 2 + 0.46), SENIOR_Y + BH * 0.62, BD / 2 + 0.34);
  g.add(sp);

  const jp = plate("JUNIOR", "FIRST LOSS · 50% OF YIELD", ACCENT);
  jp.position.set(ps * (BW / 2 + 0.46), JUNIOR_Y + BH * 0.62, BD / 2 + 0.34);
  g.add(jp);

  /* The book marker. The BOT book carries BOT Chain's own lockup — BOT is
     the chain's native token, so the mark is the accurate label rather than
     decoration. USDT is an ERC-20 on the same chain and gets plain type;
     giving it the chain mark would imply something untrue. */
  const isNative = bookLabel === "BOT";
  const bb = board(460, 150, (c) => {
    c.clearRect(0, 0, 460, 150);
    cardHead(c, 4, 38, "BOOK", ACCENT_DEEP, 20);
    if (isNative) drawBotChain(c, 4, 58, 400);
    else figureText(c, 4, 118, bookLabel, PAPER, 62, "700");
  });
  const bp = boardPlane(bb, 0.95, 0.95 * 150 / 460, { renderOrder: 4 });
  /* Low on the frame, like a plaque — NOT floating above the rig. Up there
     it drifted into the top-left caption block on any shot taken from the
     right of the stage, and a book identifier is not worth putting over the
     scene's own title. */
  bp.position.set(-ps * (BW / 2 - 0.62), 0.34, BD / 2 + 0.30);
  g.add(bp);

  const levels: Record<Tranche, number> = { senior: 0, junior: 0 };
  const wiped: Record<Tranche, boolean> = { senior: false, junior: false };

  function paint(which: Tranche): void {
    const t = which === "senior" ? senior : junior;
    const base = which === "senior" ? ACCENT_LIGHT : ACCENT;
    t.fillMat.color.setHex(wiped[which] ? LOSS : base);
  }

  return {
    g,
    setLevel(which, level) {
      const v = clamp(level);
      levels[which] = v;
      const t = which === "senior" ? senior : junior;
      /* An empty tank must render NOTHING. Scaling the fill box to 0.0001
         to dodge the degenerate-normal flicker leaves its top face lying
         flat on the tank floor — from the deck's elevated camera that is a
         full-width coloured sheet, and in S5 it read as a layer of capital
         still sitting in a junior tranche the scene had just claimed was
         wiped out. Exactly the kind of thing §7 exists to stop.

         So: hide it outright below a hair's width, and keep the tiny floor
         only for levels that are genuinely non-zero. */
      const h = v * BH;
      t.fill.visible = h > 0.004;
      t.fill.scale.y = Math.max(h, 0.0001);
    },
    level: (which) => levels[which],
    setWiped(which, w) { wiped[which] = w; paint(which); },
    update() {
      /* Nothing. Deliberately.

         A fill that shimmers or sloshes on idle is a fill that is moving
         when no money moved, and at a glance that is indistinguishable from
         the level changing. §7 rule 3. The basins are still until a beat
         moves them. */
    },
  };
}
