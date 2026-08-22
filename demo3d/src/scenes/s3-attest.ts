/* S3 · THE ATTESTATION — PLAN.md §5.
   ─────────────────────────────────────────────────────────────────────────
   Line: the grade is bolted to the invoice, on chain.

   One shot. The press lifts (anticipation), falls, lands, the camera kicks,
   the slab squashes and rings out, and the grade tab is now PART of the
   slab. Then a hold.

   §7 RULE 4 IS THE WHOLE SCENE. The letter appears on the impact frame and
   not one frame earlier. There is no dim letter, no placeholder tab, no
   reveal-by-fade from a value that was already sitting there. The tab does
   not exist in the scene graph until the press lands, because
   `setGrade(null)` removes it — there is nothing to leak.

   The kick is ANALYTIC: a damped ring off a known impact time, not a
   frame-edge transient. §9 — a scene that shakes differently depending on
   when the renderer got round to it cannot be re-rendered.

   Loop 18s. */

import * as THREE from "three";
import type { Scene3D, Shot, Caption } from "../engine";
import { gridFloor, obox, softShadow, glowSprite } from "../voxel";
import { board, boardPlane, cardHead, figureText, rule } from "../board";
import { css, INK, PAPER, ACCENT, SUCCESS, STEEL, STEEL_DARK, STEEL_LIGHT } from "../palette";
import { makeEnvironment, type EnvHandle } from "../env";
import { makeInvoice, type InvoiceHandle } from "../cast/invoice";
import { makeFigure, type FigureHandle } from "../cast/figure";
import { seg, eInOut, eInCubic, eOutBack, ring, lerp, impactY } from "../craft";

const LOOP = 18;

const S = {
  lift: 2.2, lifted: 3.6,   // the press winds up
  fall: 4.0, land: 4.62,    // and comes down. IMPACT at S.land.
  rise: 6.4,                // it withdraws, leaving the tab
  holdEnd: 14.6,
  reset: 15.4,              // grade removed, next invoice — the loop seam
};

const GRADE = "B";

/** Half the page's height, at the scene's scale — see `build`. */
const REST_Z = 2.1 * 0.92 / 2;

export function s3Attest(): Scene3D {
  let env: EnvHandle;
  let inv: InvoiceHandle;
  let press: THREE.Group;
  let flash: THREE.Sprite;
  let supplier: FigureHandle;
  let record: THREE.Mesh;
  let graded = false;

  return {
    loop: LOOP,

    build(root) {
      env = makeEnvironment(root, { kind: "racks", density: 0.55, motes: 5, seed: 47 });
      gridFloor(root, 50, ACCENT, 0.085);

      // the anvil the slab lies on
      obox(root, 3.4, 0.34, 2.6, STEEL_DARK, 0, 0.17, 0, { outlineThickness: 0.07 });
      obox(root, 3.0, 0.10, 2.2, STEEL, 0, 0.38, 0, { outlineThickness: 0.06 });

      inv = makeInvoice(root, { buyer: "ACME CORP", amount: "26,480.00", hash: "0x8f2c…41ab" });
      /* The page's own origin is its BOTTOM edge, and lying it flat maps its
         height onto world -z — so at z 0 the whole slab sat upstage of the
         anvil's centre line, hanging off the back edge with the near half of
         the anvil bare. Offset by half its height so the document is centred
         on the block it is being stamped on. */
      inv.g.position.set(0, 0.43, REST_Z);
      inv.g.rotation.x = -Math.PI / 2;   // lying flat on the anvil, face up
      inv.g.scale.setScalar(0.92);
      inv.setState("committed");
      inv.setGrade(null);

      /* The supplier places it on the desk. The press is not a thing that
         happens TO an invoice that arrived by itself — someone brings it,
         and someone is standing there when the grade is bound to it. */
      supplier = makeFigure(root, "supplier");
      /* Behind the desk, not beside it. The shot is a low three-quarter from
         the front, so anything standing on the camera side of the anvil sits
         squarely on top of the thing being stamped. */
      supplier.g.position.set(-0.55, 0, -2.5);
      supplier.face(-0.30);
      supplier.g.scale.setScalar(0.9);

      /* -- the press ---------------------------------------------------- */
      press = new THREE.Group();
      // Positioned over the corner the tab appears on, so the press and the
      // mark it leaves are visibly the same event.
      press.position.x = 0.52;
      press.position.z = REST_Z - 1.62;
      root.add(press);
      /* Narrow. It marks a SPOT on the document — it does not cover it.
         The first pass used a 1.5-unit die on a 1.4-unit page and the slab
         simply vanished under it for the whole scene. */
      obox(press, 0.95, 0.42, 0.95, STEEL_LIGHT, 0, 0, 0, { outlineThickness: 0.06 });
      obox(press, 0.42, 1.9, 0.42, STEEL, 0, 1.05, 0, { outlineThickness: 0.06 });
      obox(press, 1.35, 0.30, 1.35, STEEL_DARK, 0, 2.10, 0, { outlineThickness: 0.07 });
      // the die face — what it stamps
      const db = board(360, 360, (c) => {
        c.clearRect(0, 0, 360, 360);
        c.fillStyle = css(INK);
        c.fillRect(0, 0, 360, 360);
        c.strokeStyle = css(ACCENT);
        c.lineWidth = 8;
        c.strokeRect(4, 4, 352, 352);
        cardHead(c, 26, 62, "ATTEST", ACCENT, 26);
        rule(c, 26, 80, 308, ACCENT, 0.35);
        cardHead(c, 26, 132, "ERC-721", PAPER, 22);
        cardHead(c, 26, 176, "BOUND TO", PAPER, 22);
        cardHead(c, 26, 220, "0X8F2C…41AB", PAPER, 22);
        cardHead(c, 26, 320, "CIFRA", ACCENT, 30);
      });
      const dp = boardPlane(db, 0.80, 0.80, { renderOrder: 5 });
      dp.rotation.x = -Math.PI / 2;
      dp.position.set(0, -0.23, 0);
      press.add(dp);
      softShadow(press, 2.4, 0.22);

      flash = glowSprite(ACCENT, 4.2, 0);
      flash.position.set(0.52, 0.7, REST_Z - 1.62);
      root.add(flash);

      /* -- the attestation record, standing behind ---------------------- */
      const ab = board(660, 400, (c) => {
        c.fillStyle = css(INK);
        c.fillRect(0, 0, 660, 400);
        c.strokeStyle = css(SUCCESS);
        c.lineWidth = 5;
        c.strokeRect(2.5, 2.5, 655, 395);
        c.fillStyle = css(SUCCESS);
        c.fillRect(0, 0, 660, 10);
        cardHead(c, 28, 58, "ATTESTED — ON CHAIN", SUCCESS, 22);
        rule(c, 28, 76, 604, SUCCESS, 0.3);
        const rows: [string, string][] = [
          ["GRADE", GRADE],
          ["RISK", "6,842 BPS"],
          ["DISCOUNT", "800 BPS"],
          ["MODEL", "CIFRA-SCORE-V1"],
          ["DIGEST", "SHA256:4B9C…E017"],
        ];
        let y = 132;
        for (const [k, v] of rows) {
          cardHead(c, 28, y, k, ACCENT, 18);
          figureText(c, 632, y, v, PAPER, 24, "700", "right");
          y += 48;
        }
      });
      const ap = boardPlane(ab, 2.5, 2.5 * 400 / 660, { transparent: false, renderOrder: 5 });
      ap.position.set(3.5, 1.4, -1.2);
      ap.rotation.y = -0.5;
      ap.visible = false;
      root.add(ap);
      record = ap;
    },

    update(t) {
      env.update(t);
      inv.update(t);

      /* Steps up, sets it down, steps back — and is clear of the anvil well
         before the press moves. A figure still standing over the die when it
         falls reads as an accident about to happen. */
      const inAt = seg(t, 0.4, 1.5);
      const outAt = seg(t, S.lift - 0.9, S.lift);
      supplier.g.position.x = -0.55 + 0.18 * inAt - 0.18 * outAt;
      supplier.g.position.z = -2.5 + 0.75 * inAt - 0.75 * outAt;
      /* Watching the press, then reacting to what it left. One change, on
         the impact frame — the same frame the grade appears. */
      supplier.express(t < S.land ? "alert" : "pleased");
      supplier.update(t, (t > 0.4 && t < 1.5) || (t > S.lift - 0.9 && t < S.lift) ? 1 : 0);

      /* The slab is carried in and set down: it rides at chest height until
         the placement lands, then sits on the anvil for the rest of the loop. */
      const place = eInOut(seg(t, 0.9, 2.0));
      const back = seg(t, S.reset, LOOP);
      const carry = Math.max(0, 1 - place) + back;
      /* Carried WELL clear of the figure, not just offset from it. At 0.85
         to the side the slab's own half-width plus the torso's still put the
         two on top of each other, and the near-upright carry angle stood the
         page straight through the figure's chest and head. Held out at arm's
         length instead: far enough in x that the silhouettes separate, and
         downstage of where the figure walks so it never passes through them
         in depth either. */
      inv.g.position.set(
        lerp(0, 1.52, carry),
        lerp(0.43, 0.92, carry),
        lerp(REST_Z, REST_Z - 2.0, carry),
      );
      inv.g.rotation.x = lerp(-Math.PI / 2, -1.15, carry);

      /* The grade exists from the impact frame, and not before. */
      const wantGraded = t >= S.land && t < S.reset;
      if (wantGraded !== graded) {
        graded = wantGraded;
        inv.setGrade(wantGraded ? GRADE : null);
        inv.setState(wantGraded ? "graded" : "committed");
      }

      /* Press travel. Windup is slow-out (eInOut), the fall is eInCubic —
         it accelerates, because a press that descends at a constant rate
         has no weight. */
      const REST = 3.35, DOWN = 0.68;
      let y = REST;
      if (t >= S.lift && t < S.fall) {
        y = lerp(REST, REST + 0.55, eInOut(seg(t, S.lift, S.lifted)));
      } else if (t >= S.fall && t < S.land) {
        y = lerp(REST + 0.55, DOWN, eInCubic(seg(t, S.fall, S.land)));
      } else if (t >= S.land && t < S.rise) {
        // sits on the work for a beat, then withdraws — the hold after the
        // impact is what makes the impact read
        y = DOWN + ring(t - S.land, 0.10, 7, 16) +
          lerp(0, REST - DOWN, eInOut(seg(t, S.rise - 1.2, S.rise)));
      }
      press.position.y = y;

      /* The slab takes the blow: squash on impact, volume preserved, ringing
         out after. It is lying flat, so the compression is on its own Y —
         which after the -90° rotation is the group's Z. Scale the group. */
      const sy = impactY(t - S.land, 0.0, 0.0, 0.16);
      inv.g.scale.set(0.92 / Math.sqrt(sy) * 1.0, 0.92, 0.92 / Math.sqrt(sy));
      void sy;

      /* The record does not exist until the press lands. It was standing
         there from frame one with GRADE B already printed on it — the letter
         on screen four seconds before the stamp that produces it, in the one
         scene whose header calls §7 rule 4 the whole point. It also sat
         exactly where the slab is carried in, so hiding it fixes both. */
      record.visible = wantGraded;
      const pop = eOutBack(seg(t, S.land, S.land + 0.5));
      record.scale.setScalar(wantGraded ? lerp(0.86, 1, pop) : 1);

      flash.material.opacity = 0.75 * Math.max(0, 1 - (t - S.land) / 0.7) * (t >= S.land ? 1 : 0);
    },

    camera(t): Shot {
      /* One shot, per PLAN — movement lives inside it. Telephoto throughout:
         this is an intimate beat about one object being marked. */
      const p = eInOut(seg(t, 0, S.holdEnd));
      const base: [number, number, number] = [
        lerp(-3.9, -3.2, p), lerp(3.4, 3.0, p), lerp(7.4, 6.5, p),
      ];
      /* kick() — analytic. A damped ring off the known impact time, on the
         camera's own axes. If a thing lands and the camera does not feel it,
         the landing is not real (CRAFT.md). */
      const k = t >= S.land ? ring(t - S.land, 0.115, 9, 26) : 0;
      return {
        pos: [base[0] + k * 0.5, base[1] + k, base[2] + k * 0.3],
        look: [lerp(0.15, 0.30, p), lerp(0.72, 0.54, p) + k * 0.5, lerp(REST_Z - 1.05, REST_Z - 1.2, p)],
        fov: lerp(36, 33, p),
      };
    },

    caption(t): Caption {
      if (t < S.land) return {
        title: "The grade is bound to the invoice.",
        sub: "Not filed next to it, not looked up later — bound, in the same transaction.",
        beat: "The signed grade is minted as an attestation NFT.",
      };
      if (t < 9.5) return {
        title: "Minted.",
        sub: "The letter, the risk score, the discount, the model version, the image digest.",
        beat: "The invoice ID is inside the signature, so a grade cannot be moved to another invoice.",
      };
      return {
        title: "This is everything a funder sees.",
        sub: "A letter and a discount rate, signed by a key anyone can check against the registry.",
        beat: "Not a name. Not a balance sheet. Not one line of the buyer's history.",
      };
    },
  };
}
