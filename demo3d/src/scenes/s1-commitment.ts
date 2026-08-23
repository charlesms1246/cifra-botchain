/* S1 · THE COMMITMENT — PLAN.md §5.
   ─────────────────────────────────────────────────────────────────────────
   Line: what reaches the chain is one hash.

   The slab lies open, line items legible. One line CHANGES — and the hash
   band across its edge changes with it, in the same frame. Then the slab
   folds shut and only the band faces camera. The invoice itself stays on
   the supplier's side of the frame, physically, for the rest of the scene.

   This is the easiest privacy claim in the whole deck to demonstrate and
   /onboard already does it live; the deck's job is to make it legible at a
   glance. It also disposes of the commonest misreading of the product —
   that "private" means "trust us with it" — by showing that the thing on
   chain is a different object from the thing being financed.

   §7 rule 2 applies to the hash exactly as it applies to money: the new
   commitment APPEARS on the frame the line changes. It does not scramble,
   count, or resolve character by character on its way to a value. A hash
   settling into place would be a lie about when it was computed.

   Loop 22s. */

import type * as THREE from "three";
import type { Scene3D, Shot, Caption } from "../engine";
import { gridFloor } from "../voxel";
import { board, boardPlane, cardHead, figureText } from "../board";
import { PAPER, ACCENT_DEEP } from "../palette";
import { addr, shortAddr } from "../deck-data";
import { ACCENT } from "../palette";
import { makeEnvironment, type EnvHandle } from "../env";
import { makeInvoice, type InvoiceHandle, type LineItem } from "../cast/invoice";
import { makeFigure, type FigureHandle } from "../cast/figure";
import { seg, eInOut, eOutBack, lerp } from "../craft";

const LOOP = 22;

const S = {
  edit: 5.4,        // the line item changes — and the hash with it
  fold: 10.2, foldEnd: 11.6,
  settle: 13.0,
  reopen: 19.4,     // the loop reset, played on screen
};

const ITEMS_A: LineItem[] = [
  ["Assembly, unit 4400-C", "18,400.00"],
  ["Finishing + QA", "6,250.00"],
  ["Freight, DDP", "1,830.00"],
];
/* One line differs. That is the whole demonstration: a different invoice is
   a different commitment, and the chain can tell the two apart. */
const ITEMS_B: LineItem[] = [
  ["Assembly, unit 4400-C", "18,400.00"],
  ["Finishing + QA", "6,900.00"],
  ["Freight, DDP", "1,830.00"],
];
const HASH_A = "0x8f2c…41ab";
const HASH_B = "0x3d7e…c092";

export function s1Commitment(): Scene3D {
  let env: EnvHandle;
  let inv: InvoiceHandle;
  let supplier: FigureHandle;
  let registry: THREE.Mesh;
  let edited = false;

  return {
    loop: LOOP,

    build(root) {
      env = makeEnvironment(root, { kind: "freight", density: 0.45, motes: 6, seed: 31, loop: LOOP });
      gridFloor(root, 60, ACCENT, 0.085);

      inv = makeInvoice(root, { buyer: "ACME CORP", amount: "26,480.00", hash: HASH_A, items: ITEMS_A });
      inv.g.position.set(1.8, 0, 0);
      inv.g.scale.setScalar(1.0);
      inv.setState("draft");

      supplier = makeFigure(root, "supplier");
      supplier.g.position.set(-0.7, 0, 1.7);
      supplier.face(0.55);

      /* -- where the commitment lands -----------------------------------
         The third beat says "that hash is what reaches the chain". Naming
         the contract it reaches is the difference between a claim and a
         thing a viewer can look up. Mechanism, not status, so an address
         belongs on it.

         Placed UPSTAGE-RIGHT of the slab (which sits at x 1.8 and spans to
         about 2.55), not left. On the left it sat directly behind the
         supplier and read as something the FIGURE was holding rather than
         somewhere the hash had gone — and the page it belongs to was on the
         other side of frame from it.

         Still upstage (negative z) per PLAN.md §4.4: every shot here pushes
         toward the page, so anything on the camera side of it fills the
         frame at exactly the beat that has to be read.

         AND IT IS HIDDEN UNTIL ITS BEAT. I first placed it here reasoning it
         would fall outside the C1 telephoto's span; it does not — C1 holds
         to about x 4.8 and the board runs to 5.4, so it sat clipped against
         the right edge through the whole opening shot, next to a caption
         that says none of this is sent anywhere. The geometry argument was
         the wrong one to make: the fix is not a position that dodges every
         shot, it is that a prop appears on the beat it belongs to.

         That beat is S.settle, not S.fold. At the fold the page is still
         open and mid-transition, and from C2 it covers the left half of this
         board — a registry address with its first six characters behind an
         invoice. By the settle the page has folded down to the slab and the
         plate stands clear beside it, which is also where the caption starts
         saying a viewer can check this later. Struck at S.reopen with the
         rest of the reset. */
      const rb = board(680, 190, (c) => {
        cardHead(c, 4, 46, "COMMITMENT RECORDED", ACCENT_DEEP, 21);
        cardHead(c, 4, 96, "CIFRA INVOICE REGISTRY", PAPER, 26);
        figureText(c, 4, 156, shortAddr(addr.registry).toUpperCase(), ACCENT, 30, "700");
      });
      /* Narrower and higher than the first placement. C3 opens on the C2
         framing, where the slab is still large and centre-right: at x 4.15
         and y 0.78 the board's left third sat behind it for the first four
         seconds of its own beat, which cost the address its leading
         characters — the part a viewer would actually use. Lifted above the
         slab's mid-line and pulled in narrower, it clears the page from the
         first frame it appears and still sits inside the frame at HOME. */
      const rp = boardPlane(rb, 2.2, 2.2 * 190 / 680, { renderOrder: 4 });
      rp.position.set(4.55, 1.32, -0.75);
      rp.rotation.y = -0.34;
      rp.visible = false;
      root.add(rp);
      registry = rp;
    },

    update(t) {
      env.update(t);
      supplier.update(t);
      inv.update(t);

      /* On for its own beat only. Scaled in rather than switched on, because
         it arrives while the camera is already moving and a plate that pops
         mid-move reads as a glitch rather than as an arrival. */
      const shown = t >= S.settle && t < S.reopen;
      registry.visible = shown;
      if (shown) registry.scale.setScalar(lerp(0.82, 1, eOutBack(seg(t, S.settle, S.settle + 0.55))));

      /* The edit. A discrete swap on one frame — see the header. The `edited`
         guard keeps it a single redraw rather than one per frame, but the
         SCHEDULE is still a pure function of t: seek backwards and it flips
         back, so the capture reproduces either way. */
      const wantEdited = t >= S.edit && t < S.reopen;
      if (wantEdited !== edited) {
        edited = wantEdited;
        inv.setDraft(
          wantEdited
            ? { items: ITEMS_B, amount: "27,130.00", hash: HASH_B, hot: 1 }
            : { items: ITEMS_A, amount: "26,480.00", hash: HASH_A, hot: 1 },
        );
      }

      // fold shut: the slab rotates edge-on and lands committed, so the band
      // is the only thing left facing the lens
      if (t >= S.fold && t < S.reopen) {
        const p = seg(t, S.fold, S.foldEnd);
        inv.setState(t >= S.foldEnd ? "committed" : "draft");
        // a wind-up tilt before the fold — nothing starts at full speed
        const pre = seg(t, S.fold - 0.5, S.fold);
        inv.g.rotation.y = lerp(0, -0.14, eInOut(pre)) + lerp(0, 0.14, eOutBack(p));
      } else {
        inv.setState("draft");
        inv.g.rotation.y = t >= S.reopen ? lerp(0.14, 0, seg(t, S.reopen, LOOP)) : 0;
      }
    },

    camera(t): Shot {
      const HOME: Shot = { pos: [0.4, 2.7, 7.4], look: [1.4, 1.5, 0], fov: 36 };

      // C1 — over the supplier's shoulder, telephoto on the line items.
      // Compression is what makes a page of small type readable on screen.
      if (t < S.fold) {
        const p = eInOut(seg(t, 0, S.fold));
        /* Far enough back to hold the WHOLE page — masthead to commitment
           band — and offset so the document sits right of centre, leaving
           the top-left dark for the title block. The first pass framed at
           ~3.9 units: the page overflowed the frame, the commitment footer
           was off-screen, and the caption was white type on white paper. */
        return {
          pos: [lerp(-0.9, -0.3, p), lerp(2.45, 2.3, p), lerp(6.9, 6.1, p)],
          look: [1.75, lerp(1.42, 1.34, p), 0],
          fov: 30,
        };
      }
      // ── CUT ── C2 — wide as it folds. Cut ON the fold, not into a still.
      if (t < S.settle) {
        const p = seg(t, S.fold, S.settle);
        return {
          pos: [lerp(-1.6, -0.6, p), 2.9, lerp(9.0, 8.2, p)],
          look: [lerp(0.4, 1.3, p), 1.5, 0],
          fov: 44,
        };
      }
      // C3 — resolve on the band, and end exactly at HOME so the loop closes.
      const e = eInOut(seg(t, S.settle, LOOP));
      return {
        pos: [lerp(-0.6, HOME.pos[0], e), lerp(2.9, HOME.pos[1], e), lerp(8.2, HOME.pos[2], e)],
        look: [lerp(1.3, HOME.look[0], e), lerp(1.5, HOME.look[1], e), 0],
        fov: lerp(44, HOME.fov, e),
      };
    },

    caption(t): Caption {
      if (t < S.edit) return {
        title: "The invoice never leaves the supplier.",
        sub: "Line items, buyer name, terms — this page stays on their side of the table.",
        beat: "None of this is published. None of it is sent anywhere.",
      };
      if (t < S.fold) return {
        title: "A commitment to it does.",
        sub: "One hash, bound to every line on the page.",
        beat: "Change a line, and it is a different invoice. The commitment changes with it.",
      };
      if (t < S.settle) return {
        title: "That hash is what reaches the chain.",
        sub: "Thirty-two bytes. Not a name, not an amount, not a customer.",
        beat: "The chain stores the commitment. The supplier keeps the invoice.",
      };
      return {
        title: "Bound, but not disclosed.",
        sub: "Anyone can check later that this exact invoice is the one that was financed.",
        beat: "Nobody can read it from the chain — including us.",
      };
    },
  };
}
