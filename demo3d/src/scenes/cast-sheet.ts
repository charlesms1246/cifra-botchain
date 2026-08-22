/* The cast sheet — not a deck scene. The verification stage.
   ─────────────────────────────────────────────────────────────────────────
   PLAN.md §12 step 3: every invoice state must be distinguishable from the
   others, and the check is "look at the PNG", not "the code compiled". This
   lays all six out in one frame at one camera so they can be compared
   directly — and, crucially, so the frame can be desaturated and still read.

   Kept out of scenes/s*.ts on purpose. It renders no argument and it must
   never end up in the cut. */

import * as THREE from "three";
import type { Scene3D, Shot } from "../engine";
import { gridFloor } from "../voxel";
import { board, boardPlane, cardHead } from "../board";
import { css, INK, ACCENT, PAPER } from "../palette";
import { makeInvoice, type InvoiceHandle, type InvoiceState } from "../cast/invoice";

const LINEUP: { state: InvoiceState; grade: string | null; note: string }[] = [
  { state: "draft",     grade: null, note: "loose sheets" },
  { state: "committed", grade: null, note: "sealed + banded" },
  { state: "graded",    grade: "B",  note: "tab bolted on" },
  { state: "funded",    grade: "B",  note: "clear of the floor" },
  { state: "settled",   grade: "B",  note: "stamped" },
  { state: "defaulted", grade: "A",  note: "corner torn" },
];

const GAP = 2.30;

function label(text: string, note: string): THREE.Mesh {
  const b = board(520, 130, (c) => {
    c.clearRect(0, 0, 520, 130);
    c.fillStyle = css(INK, 0.86);
    c.fillRect(0, 0, 520, 130);
    c.strokeStyle = css(ACCENT, 0.45);
    c.lineWidth = 3;
    c.strokeRect(1.5, 1.5, 517, 127);
    cardHead(c, 22, 54, text, ACCENT, 26);
    cardHead(c, 22, 96, note, PAPER, 17);
  });
  return boardPlane(b, 1.9, 0.475, { renderOrder: 6 });
}

export function castSheet(): Scene3D {
  const invoices: InvoiceHandle[] = [];

  return {
    loop: 12,

    build(root) {
      gridFloor(root, 60, ACCENT, 0.09);

      const x0 = -((LINEUP.length - 1) * GAP) / 2;
      LINEUP.forEach((entry, i) => {
        const slot = new THREE.Group();
        slot.position.x = x0 + i * GAP;
        root.add(slot);

        const inv = makeInvoice(slot, {
          buyer: "ACME CORP",
          amount: "26,480.00",
          hash: "0x8f2c…41ab",
        });
        // Grade BEFORE state, so no frame ever exists where a graded slab
        // is showing without its tab.
        if (entry.grade) inv.setGrade(entry.grade);
        inv.setState(entry.state);
        invoices.push(inv);

        /* Plinth card, on the floor in front of the slab rather than
           floating above it. Fills the lower third the first pass left
           empty, and it is how a real cast sheet is laid out. */
        const l = label(entry.state, entry.note);
        l.position.set(0, 0.03, 1.75);
        l.rotation.x = -Math.PI / 2.35;
        slot.add(l);
      });
    },

    update(t) {
      for (const inv of invoices) inv.update(t);
    },

    camera(): Shot {
      // One static shot. A moving camera would make it harder to compare the
      // six, which is the only thing this stage is for.
      //
      // Framed on WIDTH, and specifically on the PLINTH row: the cards sit
      // 1.75 units nearer the lens than the slabs, so they run out of frame
      // first. The second pass clipped DRAFT and DEFAULTED for exactly that
      // reason — it was framed on the slabs.
      return { pos: [0, 3.4, 11.0], look: [0, 1.05, 0.2], fov: 46 };
    },
  };
}
