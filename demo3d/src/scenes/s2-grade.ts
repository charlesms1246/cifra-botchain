/* S2 · THE GRADE — PLAN.md §5. The thesis scene.
   ─────────────────────────────────────────────────────────────────────────
   Line: private inputs, published logic.

   The sealed slab goes in one slot. The wall formula lights term by term as
   each is weighed — and THE INPUTS ARE NEVER SHOWN, only that a term was
   evaluated. A signed grade comes out the other slot. The baffle is visible
   the whole time: there is no path from the in-slot to anywhere but the out.

   Then the beat this scene exists for. The camera cuts to the caveat plate
   and HOLDS on it:

       WE OPERATE THIS ROOM
       SIGNED: MODEL VERSION + IMAGE DIGEST
       NOT: HARDWARE ATTESTATION

   §7 rule 1, and the standing temptation is to make this scene beautiful and
   mysterious. Don't. /pitch slide 6 already states this boundary in prose
   and it reads as a credibility asset; animating the room as an enclave
   would trade that away for a nicer frame, at exactly the moment a reviewer
   is looking for the seam. The room does not glow. The plate does not
   animate in — it is built at full opacity in cast/room.ts and it is simply
   there, before the camera ever finds it.

   Loop 34s, seamless: at t=34 the room is idle with a fresh sealed slab at
   the in-chute and the lamps dark — identical to t=0. The reset plays ON
   SCREEN during the resolve, so the loop reads as "and the next one",
   not as a jump cut. */

import * as THREE from "three";
import type { Scene3D, Shot, Caption } from "../engine";
import { gridFloor, obox } from "../voxel";
import { board, boardPlane, cardHead, figureText, rule } from "../board";
import { css, INK, PAPER, ACCENT, SUCCESS, WARNING, LOSS, STEEL_DARK } from "../palette";
import { makeEnvironment, type EnvHandle } from "../env";
import { makeRoom, type RoomHandle, TERMS } from "../cast/room";
import { makeInvoice, type InvoiceHandle } from "../cast/invoice";
import { scorerAddr, shortAddr, shortDigest } from "../deck-data";
import { makeFigure, type FigureHandle } from "../cast/figure";
import { seg, eInOut, eOutBack, eOutCubic, lerp, arc, impactY } from "../craft";

const LOOP = 40;

const S = {
  feedStart: 2.2, feedEnd: 3.9,      // slab travels into the in-slot
  /* One lamp per term. Spaced so the eye can follow each — CRAFT.md: one
     idea per beat. Four terms lighting at once would read as a progress bar
     and say nothing about the model. */
  term: [4.9, 6.4, 7.9, 9.4],
  cardOut: 12.4, cardSet: 13.9,      // the grade emerges and settles

  /* THE REFUSAL. A second submission arrives whose inputs do not match what
     the source committed to, and the service will not grade it.
     `server.go:146` runs `verifyProvenance` BEFORE `scoring.Score`, so on a
     mismatch nothing is scored at all — which is why the term lamps stay
     dark for this one. That ordering is the beat.

     §7 rule 6 and meld's CRAFT.md both require a refusal on screen. Without
     it this scene only ever shows the room saying yes. */
  badIn: 16.6, badSet: 18.0,
  refuse: 19.8,
  caveatCut: 24.0,                   // HARD CUT to the plate
  resolve: 31.0,
  reset: 36.0,                       // lamps dark, cards gone
  reload: 37.0, reloadEnd: 39.0,     // the next sealed slab arrives
};

/* Grade B. The discount follows the published model exactly:
   baseRateBps 400 + gradeSpreadBps["B"] 400 = 800. If the grade on screen
   and the spread on screen disagree, the one thing this scene claims — that
   the logic is checkable — is the thing it disproves. */
const GRADE = "B";
const RISK_BPS = "6,842";
const DISCOUNT_BPS = "800";

export function s2Grade(): Scene3D {
  let env: EnvHandle;
  let room: RoomHandle;
  let slab: InvoiceHandle;
  let card: THREE.Group;
  let cardShadow: THREE.Mesh;
  let badSub: THREE.Group;
  let refused: THREE.Group;
  let supplier: FigureHandle;
  let funder: FigureHandle;

  const IN_X = -3.7;      // where the sealed slab waits, at the in-chute
  const OUT_X = 3.7;

  return {
    loop: LOOP,

    build(root) {
      env = makeEnvironment(root, { kind: "racks", density: 0.62, motes: 6, seed: 23 });
      gridFloor(root, 60, ACCENT, 0.085);

      room = makeRoom(root);

      slab = makeInvoice(root, { buyer: "ACME CORP", amount: "26,480.00", hash: "0x8f2c…41ab" });
      slab.g.scale.setScalar(0.62);
      slab.setState("committed");
      // No grade. There is no letter anywhere in this scene until the card
      // comes out — §7 rule 4, and setGrade(null) means there is nothing to
      // leak, not merely something hidden.
      slab.setGrade(null);

      /* Someone hands it in, and someone takes what comes out. The room is
         not a machine that invoices wander into by themselves — a supplier
         submits, and a funder receives the grade. Having both on stage also
         makes the one-way baffle legible as a fact about PEOPLE: these two
         never meet, and nothing passes between them but the card. */
      supplier = makeFigure(root, "supplier");
      supplier.g.position.set(IN_X - 1.5, 0, 1.5);
      supplier.face(1.15);

      funder = makeFigure(root, "funder");
      funder.g.position.set(OUT_X + 1.9, 0, 1.6);
      funder.face(-1.2);

      /* -- the signed grade card ---------------------------------------- */
      card = new THREE.Group();
      root.add(card);
      obox(card, 1.55, 1.15, 0.12, INK, 0, 0, 0, { outlineThickness: 0.055 });
      const cb = board(620, 460, (c) => {
        c.fillStyle = css(INK);
        c.fillRect(0, 0, 620, 460);
        c.strokeStyle = css(SUCCESS);
        c.lineWidth = 6;
        c.strokeRect(3, 3, 614, 454);
        c.fillStyle = css(SUCCESS);
        c.fillRect(0, 0, 620, 12);

        cardHead(c, 30, 62, "SIGNED GRADE", SUCCESS, 22);
        figureText(c, 30, 168, GRADE, SUCCESS, 118, "700");
        figureText(c, 250, 132, "RISK   " + RISK_BPS + " BPS", PAPER, 26, "400");
        figureText(c, 250, 172, "DISC     " + DISCOUNT_BPS + " BPS", PAPER, 26, "400");
        rule(c, 30, 208, 560, SUCCESS, 0.3);
        cardHead(c, 30, 254, "MODEL   CIFRA-SCORE-V1", PAPER, 19);
        /* Real digest, from deck-data — the same constant S3 prints, so the
           two scenes cannot drift. The beat under this card is "a digest
           proves what the model is"; an invented one proves nothing and is
           the one thing on screen a reviewer would try to check first. */
        cardHead(c, 30, 290, `DIGEST  ${shortDigest()}`, PAPER, 19);
        /* The key the attestation contract verifies against. This card is
           what a funder is handed, and the caption calls it "a signature
           anyone can check" — so name the signer. */
        cardHead(c, 30, 326, `SIGNER  ${shortAddr(scorerAddr).toUpperCase()}`, PAPER, 19);
        cardHead(c, 30, 362, "INVOICE 0X8F2C…41AB", PAPER, 19);
        rule(c, 30, 384, 560, SUCCESS, 0.2);
        cardHead(c, 30, 428, "NO BUYER DATA ON THIS CARD", ACCENT, 18);
      });
      const cp = boardPlane(cb, 1.42, 1.42 * 460 / 620, { transparent: false, renderOrder: 5 });
      cp.position.set(0, 0, 0.075);
      card.add(cp);

      /* -- the refused submission -------------------------------------
         A data packet whose SOURCE SEAL is visibly broken — two halves
         offset. The refusal is about the data, not the invoice, so the prop
         that gets turned away is the data. */
      badSub = new THREE.Group();
      root.add(badSub);
      obox(badSub, 1.1, 1.35, 0.14, PAPER, 0, 0, 0, { outlineThickness: 0.05 });
      obox(badSub, 0.34, 0.16, 0.06, WARNING, -0.13, 0.30, 0.09, { rz: 0.22, outlineThickness: 0.04 });
      obox(badSub, 0.34, 0.16, 0.06, WARNING, 0.17, 0.22, 0.09, { rz: -0.3, outlineThickness: 0.04 });
      const sub = board(420, 500, (c) => {
        c.clearRect(0, 0, 420, 500);
        cardHead(c, 18, 60, "BUYER HISTORY", INK, 19);
        cardHead(c, 18, 96, "SOURCE-SIGNED", INK, 15);
        c.fillStyle = css(WARNING);
        c.fillRect(14, 396, 392, 88);
        cardHead(c, 26, 432, "SOURCE SEAL", INK, 17);
        cardHead(c, 26, 468, "DOES NOT MATCH", INK, 17);
      });
      const subp = boardPlane(sub, 0.98, 0.98 * 500 / 420, { renderOrder: 5 });
      subp.position.set(0, 0, 0.075);
      badSub.add(subp);
      badSub.visible = false;

      /* -- the refusal card ------------------------------------------- */
      refused = new THREE.Group();
      root.add(refused);
      obox(refused, 1.55, 1.15, 0.12, INK, 0, 0, 0, { outlineThickness: 0.055 });
      const rb = board(620, 460, (c) => {
        c.fillStyle = css(INK);
        c.fillRect(0, 0, 620, 460);
        c.strokeStyle = css(LOSS);
        c.lineWidth = 6;
        c.strokeRect(3, 3, 614, 454);
        c.fillStyle = css(LOSS);
        c.fillRect(0, 0, 620, 12);
        cardHead(c, 30, 62, "REFUSED", LOSS, 30);
        rule(c, 30, 84, 560, LOSS, 0.35);
        cardHead(c, 30, 146, "PROVENANCE MISMATCH", PAPER, 21);
        cardHead(c, 30, 190, "THE INPUTS DO NOT HASH", PAPER, 17);
        cardHead(c, 30, 224, "TO THE COMMITTED VALUE", PAPER, 17);
        rule(c, 30, 268, 560, LOSS, 0.22);
        cardHead(c, 30, 322, "NO GRADE SIGNED", LOSS, 22);
        cardHead(c, 30, 366, "NOTHING WAS SCORED", PAPER, 17);
        cardHead(c, 30, 420, "THE MODEL NEVER RAN", ACCENT, 17);
      });
      const rp = boardPlane(rb, 1.42, 1.42 * 460 / 620, { transparent: false, renderOrder: 5 });
      rp.position.set(0, 0, 0.075);
      refused.add(rp);
      refused.visible = false;

      cardShadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 1.0),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
      );
      cardShadow.rotation.x = -Math.PI / 2;
      cardShadow.position.set(OUT_X + 0.5, 0.03, 0.2);
      root.add(cardShadow);

      // a small receiving plinth under the out-chute, so the card lands on
      // something rather than hanging in air
      obox(root, 1.9, 0.20, 1.4, STEEL_DARK, OUT_X + 0.5, 0.10, 0.2, { outlineThickness: 0.06 });
    },

    update(t) {
      env.update(t);
      room.update(t);
      slab.update(t);

      /* The supplier steps up to the chute to hand the slab in, then steps
         back. The funder steps in as the card lands and takes it away. */
      const supStep = seg(t, S.feedStart - 1.1, S.feedStart) - seg(t, S.feedEnd, S.feedEnd + 1.0);
      supplier.g.position.x = IN_X - 1.5 + 0.95 * supStep;
      supplier.update(t, Math.abs(
        seg(t, S.feedStart - 1.1, S.feedStart) - seg(t, S.feedStart - 1.1, S.feedStart - 0.1)
      ) > 0 || (t > S.feedEnd && t < S.feedEnd + 1.0) ? 1 : 0);

      const funStep = seg(t, S.cardOut - 0.8, S.cardSet) - seg(t, S.reset, S.reset + 1.2);
      funder.g.position.x = OUT_X + 1.9 - 0.85 * funStep;
      funder.update(t, (t > S.cardOut - 0.8 && t < S.cardSet) || (t > S.reset && t < S.reset + 1.2) ? 1 : 0);

      /* ── the slab is fed in, and a fresh one arrives at the end ────── */
      const waiting = t < S.feedStart || t >= S.reload;
      const feeding = t >= S.feedStart && t < S.feedEnd;
      slab.g.visible = waiting || feeding;

      if (feeding) {
        const p = eInOut(seg(t, S.feedStart, S.feedEnd));
        const [x, y, z] = arc(IN_X, 1.05, 1.1, room.inMouth.x + 0.35, 1.55, 0, p, 0.35);
        slab.g.position.set(x, y, z);
        // it shrinks into the chute mouth rather than clipping through it
        slab.g.scale.setScalar(lerp(0.62, 0.30, seg(p, 0.62, 1)));
        slab.g.rotation.y = lerp(0.30, 0, p);
      } else if (t >= S.reload) {
        // the next one walks in — the loop's reset, played on screen
        const p = eOutBack(seg(t, S.reload, S.reloadEnd));
        slab.g.position.set(lerp(IN_X - 3.0, IN_X, p), 1.05, 1.1);
        slab.g.scale.setScalar(0.62);
        slab.g.rotation.y = 0.30;
      } else {
        slab.g.position.set(IN_X, 1.05, 1.1);
        slab.g.scale.setScalar(0.62);
        slab.g.rotation.y = 0.30;
      }

      /* ── the terms light, one per beat ────────────────────────────── */
      for (let i = 0; i < TERMS.length; i++) {
        /* They go DARK when the refused submission goes in, and stay dark.
           They were still lit from the first grading while the caption said
           "the terms never lit" — the frame contradicting the line over it.
           Nothing is weighed for a submission that fails provenance, so
           nothing may be lit for it. */
        const on = t >= S.term[i] && t < S.badIn - 0.6;
        // a short ramp so the lamp arrives rather than snapping on, but it
        // starts AT the beat — never before it
        room.setTermLit(i, on ? eOutCubic(seg(t, S.term[i], S.term[i] + 0.28)) : 0);
      }

      /* ── the refusal ──────────────────────────────────────────────
         The bad submission goes in and NOTHING comes back but a refusal.
         Note what does not happen: the term lamps never light for it. The
         provenance check runs before the model, so on a mismatch there is
         no scoring to show. */
      const badFlying = t >= S.badIn && t < S.badSet;
      const badGone = t >= S.badSet && t < S.reset;
      badSub.visible = t >= S.badIn - 1.1 && t < S.badSet;
      if (badSub.visible) {
        const p = eInOut(seg(t, S.badIn - 1.1, S.badSet));
        const [x, y, z] = arc(IN_X - 2.4, 1.05, 1.1, room.inMouth.x + 0.35, 1.55, 0, p, 0.4);
        badSub.position.set(x, y, z);
        badSub.scale.setScalar(lerp(0.85, 0.42, seg(p, 0.6, 1)));
        badSub.rotation.y = lerp(0.35, 0, p);
      }
      void badFlying;

      const refusing = t >= S.refuse && t < S.reset;
      refused.visible = refusing;
      if (refusing) {
        const p = eInOut(seg(t, S.refuse, S.refuse + 1.3));
        const [x, y, z] = arc(
          room.outMouth.x, room.outMouth.y, 0,
          OUT_X + 0.5, 2.05, 0.2, p, 0.45,
        );
        const sy = impactY(t - (S.refuse + 1.3), 0.3, 0.05, 0.11);
        refused.position.set(x, y, z);
        refused.rotation.set(lerp(-0.4, 0, eOutBack(p)), lerp(-0.35, 0, p), 0);
        refused.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      }
      void badGone;

      /* ── the grade card emerges ───────────────────────────────────── */
      const cardUp = t >= S.cardOut && t < S.reset;
      card.visible = cardUp;
      cardShadow.visible = cardUp;
      if (cardUp) {
        const p = eInOut(seg(t, S.cardOut, S.cardSet));
        const [x, y, z] = arc(
          room.outMouth.x, room.outMouth.y, 0,
          OUT_X + 0.5, 0.78, 0.2, p, 0.55,
        );
        // squash on landing, volume preserved
        const sy = impactY(t - S.cardSet, 0.35, 0.05, 0.12);
        card.position.set(x, y, z);
        card.rotation.set(lerp(-0.5, 0, eOutBack(p)), lerp(-0.4, 0, p), 0);
        card.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
        (cardShadow.material as THREE.MeshBasicMaterial).opacity = 0.30 * p;
      }
    },

    camera(t): Shot {
      const HOME: Shot = { pos: [1.2, 3.6, 10.6], look: [0, 1.75, 0], fov: 40 };

      // C1 — establish. A slow push, so the scene arrives rather than
      // standing there already assembled (CRAFT.md: enter on motion).
      if (t < 4.6) {
        const p = eInOut(seg(t, 0, 4.6));
        return {
          pos: [lerp(1.2, 0.6, p), lerp(3.6, 3.3, p), lerp(10.6, 9.3, p)],
          look: [lerp(0, -0.5, p), 1.75, 0],
          fov: 40,
        };
      }
      // C2 — dolly LEFT to RIGHT along the formula wall as the terms light.
      // Telephoto: this is a thesis beat, and compression is what says
      // "look at this" rather than "here is a building".
      if (t < S.cardOut) {
        const p = seg(t, 4.6, S.cardOut);
        const e = eInOut(p);
        // Held back far enough that the ROOM is still legible as a room.
        // The first pass dollied at 5 units and filled the frame with wall
        // — the formula read beautifully and the scene lost the building it
        // is written on, along with the slots either side of it.
        return {
          pos: [lerp(-3.4, 2.4, e), 2.75, lerp(9.2, 9.0, e)],
          look: [lerp(-2.2, 1.4, e), 1.40, 0.6],
          fov: 32,
        };
      }
      // ── CUT ── C3 — tight on the out-slot as the grade lands.
      if (t < S.badIn) {
        const p = seg(t, S.cardOut, S.badIn);
        return {
          pos: [lerp(5.4, 5.0, p), lerp(2.5, 2.2, p), lerp(4.6, 4.0, p)],
          look: [lerp(3.6, 4.0, p), lerp(1.5, 1.0, p), 0.2],
          fov: 28,
        };
      }
      /* ── CUT ── C3b — THE REFUSAL. Framed to hold the dark term lamps and
         the out-slot in one shot, because the point is what did NOT happen:
         nothing lit, and what came out is not a grade. */
      if (t < S.caveatCut) {
        const p = eInOut(seg(t, S.badIn, S.caveatCut));
        return {
          pos: [lerp(1.4, 2.6, p), lerp(2.9, 2.6, p), lerp(9.6, 8.8, p)],
          look: [lerp(0.4, 2.0, p), lerp(1.5, 1.6, p), 0.5],
          fov: 34,
        };
      }
      // ── HARD CUT ── C4 — the caveat plate. Almost still: the hold IS the
      // beat. A drifting camera here would read as impatience with it.
      if (t < S.resolve) {
        const p = seg(t, S.caveatCut, S.resolve);
        return {
          pos: [lerp(1.75, 1.62, p), 2.05, lerp(4.5, 4.15, p)],
          look: [1.49, 1.76, 1.44],
          fov: 34,
        };
      }
      // C5 — resolve to HOME, exactly, so t=34 and t=0 are the same frame.
      const e = eInOut(seg(t, S.resolve, LOOP));
      return {
        pos: [lerp(1.62, HOME.pos[0], e), lerp(2.05, HOME.pos[1], e), lerp(4.15, HOME.pos[2], e)],
        look: [lerp(1.49, HOME.look[0], e), lerp(1.76, HOME.look[1], e), lerp(1.44, HOME.look[2], e)],
        fov: lerp(34, HOME.fov, e),
      };
    },

    caption(t): Caption {
      if (t < 4.6) return {
        title: "The buyer's history goes in.",
        sub: "To the scoring service and nowhere else. It is never published, and it never reaches the chain.",
        beat: "One slot in. One slot out. Nothing passes between them.",
      };
      if (t < S.cardOut) return {
        title: "The model is published.",
        sub: "A weighted formula over four terms — no hidden state, no black box.",
        beat: "Each term is weighed. What it was weighed against is never shown.",
      };
      if (t < S.badIn) return {
        title: "A signed grade comes out.",
        sub: "The letter, the discount, the model version, and the digest of the image that produced it.",
        beat: "A grade and a signature anyone can check — and no buyer data at all.",
      };
      if (t < S.refuse) return {
        title: "And it refuses.",
        sub: "The data source signs a commitment to the buyer's history. These inputs do not match the one it signed.",
        beat: "Someone edited the data after the source vouched for it.",
      };
      if (t < S.caveatCut) return {
        title: "Nothing was scored.",
        sub: "The provenance check runs before the model does, so the terms stayed dark and no grade exists to sign.",
        beat: "A refusal is a result. It is on screen because hiding it would be the dishonest version.",
      };
      if (t < S.resolve) return {
        title: "And we say what this is not.",
        sub: "We operate the scoring service. Encryption keeps buyer data out of proxy logs, not away from us.",
        beat: "A digest proves what the model is. It does not prove which container ran.",
      };
      return {
        title: "Private inputs. Published logic.",
        sub: "The grade is checkable by anyone. The data behind it is seen by no one who was not already trusted with it.",
        beat: "That is the trade Cifra actually makes — stated, not implied.",
      };
    },
  };
}
