/* S0 · THE TRADE — PLAN.md §5. The problem.
   ─────────────────────────────────────────────────────────────────────────
   Line: financing an invoice costs you your customer list.

   The invoice crosses to the factor and cash comes back. That much is a fair
   trade and the scene plays it as one. Then the second thing crosses — a
   drawer of customer records — and it does NOT come back. The drawer stays
   open. That open drawer is the problem statement, and it is the last thing
   on screen before the cut to S1.

   LOOP NOTE. In the linear cut (§2.3 segment 1) the edit leaves this scene
   during the hold at ~14-20s, on the open drawer, which is where the beat
   belongs. The reset after it — cabinet shut, a fresh invoice in the
   supplier's hands — exists so the standalone loop closes, and it reads as
   the next supplier making the same trade. That is a fair thing for it to
   say; it is a systemic problem, not a one-off. */

import * as THREE from "three";
import type { Scene3D, Shot, Caption } from "../engine";
import { gridFloor, obox, softShadow } from "../voxel";
import { board, boardPlane, cardHead } from "../board";
import { PAPER, ACCENT, ACCENT_DEEP, SUCCESS, WARNING, STEEL, STEEL_DARK, STEEL_LIGHT } from "../palette";
import { makeEnvironment, type EnvHandle } from "../env";
import { makeInvoice, type InvoiceHandle } from "../cast/invoice";
import { makeFigure, type FigureHandle } from "../cast/figure";
import { seg, eInOut, eOutBack, eOutCubic, lerp, arc, impactY, prng } from "../craft";

const LOOP = 26;

const S = {
  handOver: 3.0, handLand: 4.6,     // the invoice crosses
  cashBack: 6.0, cashLand: 7.4,     // cash comes back
  drawerPull: 9.2, drawerOpen: 10.6, // and then the drawer opens
  recordsFly: 11.2, recordsGone: 14.0,
  holdEnd: 20.0,                     // ← the linear cut leaves here
  reset: 21.5, resetEnd: 25.0,
};

const SUP_X = -5.0;
const FACT_X = 5.2;
const CAB_X = -7.0;

export function s0Trade(): Scene3D {
  let env: EnvHandle;
  let inv: InvoiceHandle;
  let supplier: FigureHandle;
  let factor: FigureHandle;
  let drawer: THREE.Group;
  let cash: THREE.Group;
  let records: THREE.Group[] = [];
  let vaultGlow: THREE.Mesh;

  return {
    loop: LOOP,

    build(root) {
      env = makeEnvironment(root, { kind: "spires", density: 0.8, motes: 8, seed: 5 });
      gridFloor(root, 70, ACCENT, 0.08);

      /* -- the factor: a tower, not a person. The institution is the point. */
      const tower = new THREE.Group();
      tower.position.set(FACT_X, 0, -0.6);
      root.add(tower);
      obox(tower, 4.4, 0.3, 3.2, STEEL_DARK, 0, 0.15, 0, { outlineThickness: 0.07 });
      obox(tower, 3.6, 5.6, 2.6, STEEL, 0, 3.1, 0, { outlineThickness: 0.08 });
      obox(tower, 4.0, 0.28, 3.0, STEEL_LIGHT, 0, 5.95, 0, { outlineThickness: 0.07 });
      // the vault door — a wall of it, so what goes in does not come out
      obox(tower, 2.2, 2.4, 0.18, STEEL_DARK, 0, 1.55, 1.32, { outlineThickness: 0.06 });
      const vg = new THREE.Mesh(
        new THREE.PlaneGeometry(1.7, 1.9),
        new THREE.MeshBasicMaterial({ color: WARNING, transparent: true, opacity: 0.0, depthWrite: false }),
      );
      vg.position.set(0, 1.55, 1.43);
      tower.add(vg);
      vaultGlow = vg;
      const tb = board(560, 150, (c) => {
        c.clearRect(0, 0, 560, 150);
        cardHead(c, 6, 46, "THE FACTOR", STEEL_LIGHT, 30);
        cardHead(c, 6, 100, "TAKES THE INVOICE. KEEPS THE FILE.", PAPER, 19);
      });
      const tp = boardPlane(tb, 2.6, 2.6 * 150 / 560, { renderOrder: 5 });
      tp.position.set(0, 4.5, 1.33);
      tower.add(tp);

      /* -- the two parties -------------------------------------------- */
      supplier = makeFigure(root, "supplier");
      supplier.g.position.set(SUP_X, 0, 1.4);
      supplier.face(1.15);

      factor = makeFigure(root, "factor");
      factor.g.position.set(FACT_X - 2.9, 0, 1.9);
      factor.face(-1.15);

      /* -- the invoice ------------------------------------------------- */
      inv = makeInvoice(root, { buyer: "ACME CORP", amount: "26,480.00" });
      inv.g.scale.setScalar(0.55);
      inv.setState("draft");

      /* -- the cash that comes back ------------------------------------ */
      cash = new THREE.Group();
      root.add(cash);
      for (let i = 0; i < 3; i++) {
        obox(cash, 1.0, 0.14, 0.62, SUCCESS, 0, 0.09 + i * 0.16, 0, { outlineThickness: 0.05 });
      }
      cash.visible = false;

      /* -- the filing cabinet, and what is inside it -------------------
         The drawer is the scene. It opens, it empties, and it stays open. */
      const cab = new THREE.Group();
      cab.position.set(CAB_X, 0, 1.0);
      root.add(cab);
      softShadow(cab, 3.0, 0.34);
      obox(cab, 2.0, 2.4, 1.5, STEEL, 0, 1.2, 0, { outlineThickness: 0.07 });
      const cbl = board(520, 140, (c) => {
        c.clearRect(0, 0, 520, 140);
        cardHead(c, 6, 44, "YOUR CUSTOMERS", ACCENT, 27);
        cardHead(c, 6, 98, "NAMES · HISTORY · TERMS", PAPER, 18);
      });
      const cblp = boardPlane(cbl, 1.8, 1.8 * 140 / 520, { renderOrder: 5 });
      cblp.position.set(0, 2.05, 0.78);
      cab.add(cblp);

      drawer = new THREE.Group();
      drawer.position.set(0, 1.05, 0);
      cab.add(drawer);
      obox(drawer, 1.86, 0.72, 1.4, STEEL_DARK, 0, 0, 0, { outlineThickness: 0.06 });
      obox(drawer, 1.9, 0.78, 0.10, STEEL_LIGHT, 0, 0, 0.72, { outlineThickness: 0.06 });
      obox(drawer, 0.52, 0.10, 0.12, ACCENT_DEEP, 0, 0, 0.80, { outlineThickness: 0.04 });

      /* record cards standing in the drawer — they are the customer file */
      const R = prng(17);
      records = [];
      for (let i = 0; i < 7; i++) {
        const card = new THREE.Group();
        obox(card, 0.30, 0.62, 0.04, PAPER, 0, 0, 0, { outlineThickness: 0.035, rz: (R() - 0.5) * 0.12 });
        obox(card, 0.30, 0.10, 0.05, ACCENT, 0, 0.24, 0.01, { outlineThickness: 0.03 });
        card.position.set(-0.62 + i * 0.20, 0.30, (R() - 0.5) * 0.3);
        drawer.add(card);
        records.push(card);
      }
    },

    update(t) {
      env.update(t);
      supplier.update(t);
      factor.update(t);
      inv.update(t);

      /* ── the invoice crosses ─────────────────────────────────────── */
      const held = t < S.handOver || t >= S.resetEnd;
      if (held) {
        inv.g.position.set(SUP_X + 0.9, 1.0, 1.8);
        inv.g.rotation.set(0, 0.7, 0.1);
      } else {
        const p = eInOut(seg(t, S.handOver, S.handLand));
        const [x, y, z] = arc(SUP_X + 0.9, 1.0, 1.8, FACT_X - 1.6, 1.4, 1.7, p, 1.4);
        inv.g.position.set(x, y, z);
        inv.g.rotation.set(0, lerp(0.7, -0.5, p), lerp(0.1, 0, eOutBack(p)));
      }

      /* ── cash comes back ─────────────────────────────────────────── */
      const cashing = t >= S.cashBack && t < S.reset;
      cash.visible = cashing;
      if (cashing) {
        const p = eInOut(seg(t, S.cashBack, S.cashLand));
        const [x, y, z] = arc(FACT_X - 1.8, 1.3, 1.7, SUP_X + 1.1, 0.12, 2.0, p, 1.5);
        const sy = impactY(t - S.cashLand, 0.3, 0.05, 0.13);
        cash.position.set(x, y, z);
        cash.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
        cash.rotation.y = lerp(-0.4, 0.15, eOutBack(p));
      }

      /* ── and then the drawer ─────────────────────────────────────── */
      // Anticipation: it hitches back before it pulls out.
      const pre = seg(t, S.drawerPull - 0.45, S.drawerPull);
      const pull = seg(t, S.drawerPull, S.drawerOpen);
      const shut = t >= S.reset ? eInOut(seg(t, S.reset, S.resetEnd)) : 0;
      const open = t >= S.drawerPull ? eOutBack(pull) * (1 - shut) : -0.06 * eInOut(pre);
      drawer.position.z = open * 1.15;

      /* records leave, one after another, and do not come back. Staggered so
         the eye reads a file being emptied rather than a block sliding. */
      records.forEach((card, i) => {
        const a = S.recordsFly + i * 0.36;
        const b = a + 1.5;
        const p = seg(t, a, b);
        if (p <= 0 || t >= S.reset) {
          card.visible = t < S.recordsFly || t >= S.reset;
          card.position.set(-0.62 + i * 0.20, 0.30, card.position.z);
          card.rotation.set(0, 0, 0);
          card.scale.setScalar(1);
          return;
        }
        card.visible = p < 1;
        const e = eInOut(p);
        // into the vault door, on an arc, tumbling
        const sx = CAB_X + (-0.62 + i * 0.20);
        const [x, y, z] = arc(sx, 1.35, 1.15, FACT_X, 1.55, 0.75, e, 2.6 + i * 0.12);
        card.position.set(x - CAB_X, y - 1.05, z - 1.0);
        card.rotation.set(e * 2.2, e * 3.4, e * 1.1);
        card.scale.setScalar(lerp(1, 0.55, e));
      });

      // the vault takes them in — the door warms as the file lands
      const swallowed = seg(t, S.recordsFly + 1.2, S.recordsGone);
      (vaultGlow.material as THREE.MeshBasicMaterial).opacity =
        0.30 * swallowed * (1 - eOutCubic(seg(t, S.reset, S.resetEnd)));

      /* ── reset: a fresh invoice for the next supplier ─────────────── */
      if (t >= S.resetEnd) inv.setState("draft");
    },

    camera(t): Shot {
      const HOME: Shot = { pos: [-1.2, 4.2, 15.5], look: [0.2, 2.1, 0], fov: 46 };

      // C1 — wide. The whole trade in one frame: two parties, a tower.
      if (t < S.drawerPull) {
        const p = eInOut(seg(t, 0, S.drawerPull));
        return {
          pos: [lerp(-1.2, 0.2, p), lerp(4.2, 3.8, p), lerp(15.5, 14.2, p)],
          look: [lerp(0.2, 0.6, p), lerp(2.1, 1.9, p), 0],
          fov: 46,
        };
      }
      // ── CUT ON THE DRAWER OPENING ── C2 — telephoto push. This is the beat.
      if (t < S.holdEnd) {
        /* Held ~8.5 units out. The first pass pushed to ~4 and put the lens
           INSIDE the cabinet: no drawer, no records, no flight path — just
           a brown wall and the supplier's shoulder filling the right third.
           A telephoto beat still needs the subject to fit in the frame. */
        const p = eInOut(seg(t, S.drawerPull, S.recordsGone));
        return {
          pos: [lerp(-9.2, -8.5, p), lerp(5.1, 4.5, p), lerp(9.0, 8.0, p)],
          look: [lerp(CAB_X + 0.6, CAB_X + 1.6, p), lerp(1.30, 1.10, p), 0.9],
          fov: 34,
        };
      }
      // C3 — resolve wide, ending exactly at HOME.
      const e = eInOut(seg(t, S.holdEnd, LOOP));
      return {
        pos: [lerp(-8.5, HOME.pos[0], e), lerp(4.5, HOME.pos[1], e), lerp(8.0, HOME.pos[2], e)],
        look: [lerp(CAB_X + 1.6, HOME.look[0], e), lerp(1.10, HOME.look[1], e), lerp(0.9, 0, e)],
        fov: lerp(34, HOME.fov, e),
      };
    },

    caption(t): Caption {
      if (t < S.cashBack) return {
        title: "An unpaid invoice is money you have already earned.",
        sub: "The work is done and delivered. The cash arrives in forty-five days.",
        beat: "Financing it is a fair trade: the invoice for the cash, at a discount.",
      };
      if (t < S.drawerPull) return {
        title: "So far, so reasonable.",
        sub: "The factor advances against the invoice and takes the discount for the wait.",
        beat: "That is not the part suppliers refuse.",
      };
      if (t < S.holdEnd) return {
        title: "This is.",
        sub: "To underwrite the buyer, the factor takes the customer file — names, payment history, terms.",
        beat: "It goes in, and it does not come back out.",
      };
      return {
        title: "Which is why most of it never happens.",
        sub: "Handing a stranger your customer list is a price a great many suppliers will not pay.",
        beat: "$2.5 trillion of unmet trade finance. SMEs rejected 41% of the time.",
      };
    },
  };
}
