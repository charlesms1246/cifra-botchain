/* The scoring room — PLAN.md §4.2. The thesis asset.
   ─────────────────────────────────────────────────────────────────────────
   §7 rule 1, restated because it is the single easiest rule in this deck to
   break by accident: THIS DOES NOT GLOW. No enclave, no aura, no halo, no
   "attested" badge. DECISIONS.md D1 deliberately downgraded the claim from a
   Flare TEE to a Cloud Run service we operate, and a beautiful mysterious
   box would restore that claim visually at precisely the moment a reviewer
   is looking for it.

   It is a plain windowless block with the published formula on the outside
   and a caveat plate bolted to the front. The mundanity IS the honesty beat.

   What it does show, structurally:
     · a slot IN and a slot OUT, on opposite ends
     · a baffle between them, so there is visibly no straight path through
     · four term lamps, one per model term, that light as each is weighed —
       never showing the inputs, only that a term was evaluated */

import * as THREE from "three";
import { obox, flat } from "../voxel";
import { board, boardPlane, cardHead, figureText, rule } from "../board";
import { css, INK, PAPER, ACCENT, ACCENT_DEEP, ACCENT_LIGHT, WARNING, STEEL, STEEL_DARK, STEEL_LIGHT } from "../palette";
import { clamp, lerp } from "../craft";

const RW = 5.0;   // room width  (slot-to-slot axis)
const RH = 2.9;   // height
const RD = 2.6;   // depth

/** The four model terms and their weights — verbatim from
 *  scorer/pkg/scoring/scoring.go:24. The formula is genuinely published;
 *  showing it is the point, so it must match the source exactly. */
export const TERMS: [string, string][] = [
  ["REPAYMENT", "0.4"],
  ["RELATIONSHIP", "0.3"],
  ["TENOR", "0.2"],
  ["JURISDICTION", "0.1"],
];

export interface RoomHandle {
  g: THREE.Group;
  /** World position of the in-slot mouth, for scenes to fly the slab to. */
  inMouth: THREE.Vector3;
  /** World position of the out-slot mouth. */
  outMouth: THREE.Vector3;
  /** 0..1 per term. Lit means "this term was weighed" — never what it was. */
  setTermLit(i: number, v: number): void;
  update(t: number): void;
}

function drawFormula(c: CanvasRenderingContext2D): void {
  const w = 1000, h = 300;
  c.fillStyle = css(STEEL_DARK);
  c.fillRect(0, 0, w, h);
  c.strokeStyle = css(ACCENT, 0.5);
  c.lineWidth = 4;
  c.strokeRect(2, 2, w - 4, h - 4);

  cardHead(c, 34, 52, "PUBLISHED MODEL · CIFRA-SCORE-V1", ACCENT, 20);
  rule(c, 34, 68, w - 68, ACCENT, 0.28);

  figureText(c, 34, 136, "risk = 0.4 repayment + 0.3 relationship", PAPER, 30, "700");
  figureText(c, 34, 180, "     + 0.2 tenor + 0.1 jurisdiction", PAPER, 30, "700");
  figureText(c, 34, 240, "grade = A>=80  B>=60  C>=40  D<40", ACCENT_LIGHT, 27, "400");
  cardHead(c, 34, h - 26, "LOGIC PUBLIC · INPUTS PRIVATE", ACCENT_DEEP, 17);
}

function drawCaveat(c: CanvasRenderingContext2D): void {
  const w = 720, h = 300;
  c.fillStyle = css(INK);
  c.fillRect(0, 0, w, h);
  c.strokeStyle = css(WARNING);
  c.lineWidth = 6;
  c.strokeRect(3, 3, w - 6, h - 6);
  c.fillStyle = css(WARNING);
  c.fillRect(0, 0, w, 12);

  cardHead(c, 30, 74, "WE OPERATE THIS ROOM", WARNING, 30);
  rule(c, 30, 96, w - 60, WARNING, 0.3);
  cardHead(c, 30, 152, "SIGNED: MODEL VERSION", PAPER, 23);
  cardHead(c, 30, 190, "+ IMAGE DIGEST", PAPER, 23);
  /* This line used to name the thing the product does NOT have. BOT Chain
     devrel asked the deck to stop referencing what was not carried over, so
     it states the scope of the signature instead. The disclosure above it —
     that we operate the room — is untouched, and it is the load-bearing
     half: what is signed is a claim about the MODEL, never about the box. */
  cardHead(c, 30, 250, "SCOPE: THE MODEL, NOT THE BOX", WARNING, 23);
}

export function makeRoom(parent: THREE.Object3D): RoomHandle {
  const g = new THREE.Group();
  parent.add(g);

  /* -- the block ------------------------------------------------------- */
  obox(g, RW, RH, RD, STEEL, 0, RH / 2, 0, { outlineThickness: 0.07 });
  // plinth
  obox(g, RW + 0.4, 0.22, RD + 0.4, STEEL_DARK, 0, 0.11, 0, { outlineThickness: 0.07 });
  // roof cap — gives the block a top edge instead of a flat lid
  obox(g, RW + 0.24, 0.18, RD + 0.24, STEEL_LIGHT, 0, RH + 0.05, 0, { outlineThickness: 0.06 });

  /* -- slots ------------------------------------------------------------
     Recessed dark mouths on the two ends. Modelled as dark boxes set INTO
     the wall rather than holes, which a box cannot have. */
  const SLOT_Y = 1.55;
  /* Chutes, not flush mouths. The first pass set the slots INTO the end
     walls, and the deck is shot from the front — the end walls are nearly
     edge-on at every camera the scene uses, so the two most important
     features of the room were invisible. They protrude now, and read in
     silhouette from anywhere. */
  const chute = (sx: number) => {
    obox(g, 0.62, 0.66, 1.20, STEEL_LIGHT, sx * (RW / 2 + 0.31), SLOT_Y, 0, {
      outlineThickness: 0.06,
    });
    return obox(g, 0.16, 0.44, 0.98, INK, sx * (RW / 2 + 0.60), SLOT_Y, 0, {
      outlineThickness: 0.05,
    });
  };
  const slotIn = chute(-1);
  const slotOut = chute(1);

  /* -- the baffle -------------------------------------------------------
     An open channel across the top of the block, with an angled plate in
     the middle of it. From the deck's elevated camera you can see straight
     down into the channel and see that the plate blocks the line from the
     in-slot to the out-slot. That is the privacy claim as geometry: there
     is no path through. */
  const chY = RH + 0.14;
  obox(g, RW * 0.86, 0.10, 0.62, STEEL_DARK, 0, chY, 0, { outlineThickness: 0.05 });
  obox(g, RW * 0.86, 0.26, 0.09, STEEL, 0, chY + 0.16, -0.30, { outlineThickness: 0.05 });
  obox(g, RW * 0.86, 0.26, 0.09, STEEL, 0, chY + 0.16, 0.30, { outlineThickness: 0.05 });
  // the plate itself, tilted across the channel
  obox(g, 0.14, 0.52, 0.60, ACCENT_DEEP, 0, chY + 0.22, 0, {
    rz: 0.62, outlineThickness: 0.05,
  });

  /* -- formula wall ----------------------------------------------------- */
  const formula = board(1000, 300, drawFormula);
  const FW = RW * 0.55;
  const fp = boardPlane(formula, FW, FW * 0.30, { transparent: false, renderOrder: 2 });
  fp.position.set(-RW / 2 + FW / 2 + 0.22, RH * 0.60, RD / 2 + 0.012);
  g.add(fp);

  /* -- term lamps -------------------------------------------------------
     One per term, under the formula. They report that a term was WEIGHED.
     They never report its value — there is deliberately no readout here,
     because the inputs are the thing that must not be shown. */
  const lamps: THREE.MeshBasicMaterial[] = [];
  const lampW = 0.48;
  const lampSpan = TERMS.length * (lampW + 0.22);
  TERMS.forEach((term, i) => {
    const x = -RW / 2 + 0.34 + lampW / 2 + i * (lampW + 0.22);
    const y = RH * 0.235;
    void lampSpan;
    obox(g, lampW + 0.10, 0.30, 0.06, STEEL_DARK, x, y, RD / 2 + 0.02, {
      outlineThickness: 0.05,
    });
    const m = flat(STEEL_DARK);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(lampW, 0.16, 0.04), m);
    lamp.position.set(x, y, RD / 2 + 0.06);
    g.add(lamp);
    lamps.push(m);

    const lb = board(320, 90, (c) => {
      c.clearRect(0, 0, 320, 90);
      cardHead(c, 4, 60, term[0], PAPER, 26);
    });
    const lp = boardPlane(lb, lampW + 0.30, (lampW + 0.30) * 90 / 320, { renderOrder: 3 });
    lp.position.set(x, y - 0.30, RD / 2 + 0.03);
    g.add(lp);
  });

  /* -- the caveat plate -------------------------------------------------
     Bolted on, standing proud of the wall on two visible bolts. It is
     STANDING CHROME: it is built here, at full opacity, and no scene is
     permitted to animate it in. §7 rule 1. */
  const caveat = board(720, 300, drawCaveat);
  /* Its own column, clear of the term lamps. The first pass put it over the
     bottom-right of the wall and it covered TENOR and JURISDICTION — the
     honesty plate obscuring two of the four things it is honest about. */
  const cw = 1.55;
  const cp = boardPlane(caveat, cw, cw * 300 / 720, { transparent: false, renderOrder: 3 });
  cp.position.set(RW / 2 - cw / 2 - 0.16, RH * 0.60, RD / 2 + 0.14);
  g.add(cp);
  /* Bolts sit OUTSIDE the plate, holding it at its edges. The first pass
     put them inset from the corners and they landed squarely on top of
     "SIGNED: MODEL VERSION" — the fixture obscuring the disclosure. */
  for (const bx of [-cw / 2 - 0.09, cw / 2 + 0.09]) {
    obox(g, 0.12, 0.12, 0.18, WARNING, cp.position.x + bx, cp.position.y, RD / 2 + 0.09, {
      outlineThickness: 0.04,
    });
  }

  const inMouth = new THREE.Vector3(-RW / 2 - 0.5, SLOT_Y, 0);
  const outMouth = new THREE.Vector3(RW / 2 + 0.5, SLOT_Y, 0);

  return {
    g, inMouth, outMouth,
    setTermLit(i, v) {
      const m = lamps[i];
      if (!m) return;
      const k = clamp(v);
      m.color.setHex(STEEL_DARK).lerp(new THREE.Color(ACCENT), k);
    },
    update(t) {
      // The only motion: a slow breath on the slot lips, so the block is not
      // dead on screen. Nothing pulses, nothing sweeps.
      const b = 0.5 + 0.5 * Math.sin(t * 0.55);
      const s = lerp(0.985, 1.015, b);
      slotIn.scale.y = s;
      slotOut.scale.y = s;
    },
  };
}
