/* The native deposit helper — PLAN.md gap 4.
   ─────────────────────────────────────────────────────────────────────────
   `CifraNativeDepositHelper` collapses two steps into one in each direction:
   `depositNative` wraps BOT, approves, deposits and forwards the shares;
   `redeemToNative` redeems, unwraps and forwards native back. Without it a
   funder wraps by hand before depositing and unwraps after withdrawing — "a
   two-step cliff on the asset that is supposed to take precedence in the UI".

   Two properties from the contract drive the design, and both are visual:

   1. **It is STATELESS and holds no funds between transactions.** So the
      prop is an open gantry you can see straight through, not a box. A
      closed machine would imply custody the contract explicitly does not
      take.
   2. **It is not privileged anywhere in the protocol** — an ordinary caller
      of the vault, and a user may always bypass it. So it sits BESIDE the
      path rather than gating it: nothing has to go through, it is just
      shorter if it does. Compare the allowlist gate in S4, which is a
      barrier across the way and is meant to read as one. */

import * as THREE from "three";
import { obox } from "../voxel";
import { board, boardPlane, cardHead } from "../board";
import { css, PAPER, ACCENT, ACCENT_LIGHT, STEEL, STEEL_DARK, STEEL_LIGHT } from "../palette";

const W = 2.0;
const H = 2.1;
const D = 1.1;

export interface HelperHandle {
  g: THREE.Group;
  /** Where a thing enters, in the helper's own local space. */
  mouth(side: -1 | 1): THREE.Vector3;
  update(t: number): void;
}

export function makeHelper(parent: THREE.Object3D, x: number, z: number): HelperHandle {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  parent.add(g);

  // plinth
  obox(g, W + 0.5, 0.24, D + 0.4, STEEL_DARK, 0, 0.12, 0, { outlineThickness: 0.06 });
  // posts + lintel — an ARCH, open through the middle
  for (const sx of [-1, 1]) {
    obox(g, 0.30, H, D, STEEL, sx * (W / 2 - 0.15), H / 2 + 0.2, 0, { outlineThickness: 0.06 });
  }
  obox(g, W + 0.24, 0.34, D + 0.16, STEEL_LIGHT, 0, H + 0.37, 0, { outlineThickness: 0.06 });

  // the roller in the arch — the only moving part, and it turns whichever
  // way something is passing
  const roller = new THREE.Group();
  roller.position.set(0, H * 0.62, 0);
  g.add(roller);
  obox(roller, 0.20, 0.20, D * 0.8, ACCENT, 0, 0, 0, { outlineThickness: 0.045 });
  obox(roller, 0.52, 0.06, D * 0.78, ACCENT_LIGHT, 0, 0, 0, { outlineThickness: 0.035 });

  const lb = board(760, 190, (c) => {
    c.clearRect(0, 0, 760, 190);
    c.fillStyle = css(0x120e0d, 0.9);
    c.fillRect(0, 0, 760, 190);
    c.strokeStyle = css(ACCENT);
    c.lineWidth = 5;
    c.strokeRect(2.5, 2.5, 755, 185);
    cardHead(c, 22, 60, "NATIVE DEPOSIT HELPER", ACCENT, 25);
    cardHead(c, 22, 112, "ONE CALL, EACH WAY", PAPER, 19);
    cardHead(c, 22, 160, "STATELESS · HOLDS NOTHING", PAPER, 16);
  });
  const lp = boardPlane(lb, 2.5, 2.5 * 190 / 760, { renderOrder: 5 });
  lp.position.set(0, H + 0.95, D / 2 + 0.02);
  g.add(lp);

  return {
    g,
    mouth: (side) => new THREE.Vector3(x + side * (W / 2 + 0.35), H * 0.62, z),
    update(t) {
      // The roller turns slowly and never stops — the helper is always
      // available, and it is doing nothing when nothing is passing.
      roller.rotation.z = t * 0.9;
    },
  };
}
