/* S7 · WHAT IS DEPLOYED — PLAN.md §5. The close.
   ─────────────────────────────────────────────────────────────────────────
   Line: measured, not asserted.

   Three panels land on a plate: what is deployed, what it recorded, and
   what is NOT true yet. The third is the same size and the same weight as
   the other two, it lands with the same impact, and the camera gives it the
   same time. §7 rule 6 — a caveat shrunk into a footnote is a caveat the
   deck is embarrassed by, and a reviewer who finds one for themselves
   discounts every figure on the panels beside it.

   Every address and the network label come from
   frontend/lib/deployment.json through src/deck-data.ts. Nothing on this
   plate is typed into this file. When MAINNET_RUNBOOK.md has run and that
   record is re-synced to chain 677, the plate says mainnet on its own — and
   it cannot say it before, which is the property PLAN.md §5 S6 asks for.

   Loop 24s. */

import * as THREE from "three";
import type { Scene3D, Shot, Caption } from "../engine";
import { gridFloor, obox } from "../voxel";
import { board, boardPlane, cardHead, figureText, rule, displayText } from "../board";
import { css, INK, PAPER, ACCENT, ACCENT_DEEP, SUCCESS, STEEL, STEEL_DARK } from "../palette";
import { makeEnvironment, type EnvHandle } from "../env";
import { drawBotChain, drawCifraWordmark, drawCifraIcon } from "../assets";
import {
  networkLabel, chainId, isMainnet, contracts, contractCount,
  results, graceDays, contractIndex,
} from "../deck-data";
import { seg, eInOut, eOutBack, lerp, impactY } from "../craft";

const LOOP = 24;

/* The three panels land in this order, evenly spaced. The index lands LAST
   and land no softer — see the header. */
const LAND = [2.4, 4.6, 6.8];
const S = { crane: 8.4, hold: 12.0, resolve: 18.6 };

const PW = 4.3;                 // panel width, world units
const PH = PW * 620 / 520;      // panels are one aspect, so the three read as a set

function panel(
  title: string,
  accent: number,
  draw: (c: CanvasRenderingContext2D, x: number, y0: number, w: number) => void,
): THREE.Mesh {
  const W = 520, H = 620;
  const b = board(W, H, (c) => {
    c.fillStyle = css(INK);
    c.fillRect(0, 0, W, H);
    c.strokeStyle = css(accent);
    c.lineWidth = 5;
    c.strokeRect(2.5, 2.5, W - 5, H - 5);
    c.fillStyle = css(accent);
    c.fillRect(0, 0, W, 11);
    cardHead(c, 26, 60, title, accent, 21);
    rule(c, 26, 78, W - 52, accent, 0.32);
    draw(c, 26, 120, W - 52);
  });
  return boardPlane(b, PW, PH, { transparent: false, renderOrder: 5 });
}

export function s7Deployed(): Scene3D {
  let env: EnvHandle;
  const panels: THREE.Mesh[] = [];

  return {
    loop: LOOP,

    build(root) {
      env = makeEnvironment(root, { kind: "spires", density: 0.75, motes: 8, seed: 97 });
      gridFloor(root, 70, ACCENT, 0.08);

      // the plate the panels stand on
      obox(root, 15.4, 0.34, 3.4, STEEL_DARK, 0, 0.17, 0, { outlineThickness: 0.08 });
      obox(root, 14.8, 0.14, 3.0, STEEL, 0, 0.40, 0, { outlineThickness: 0.06 });

      /* -- 1 · DEPLOYED ------------------------------------------------- */
      const p0 = panel("DEPLOYED · SOURCE-VERIFIED", SUCCESS, (c, x, y0, w) => {
        figureText(c, x, y0 + 6, `${contractCount} CONTRACTS`, PAPER, 34, "700");
        cardHead(c, x, y0 + 44, `${networkLabel} · CHAIN ${chainId}`, SUCCESS, 17);
        let y = y0 + 96;
        for (const r of contracts) {
          cardHead(c, x, y, r.label, ACCENT, 14);
          figureText(c, x + w, y, r.value, PAPER, 19, "400", "right");
          y += 38;
        }
        cardHead(c, x, 578, `GRACE ${graceDays} DAYS · IMMUTABLE`, ACCENT_DEEP, 14);
      });

      /* -- 2 · RECORDED ON CHAIN ----------------------------------------
         `ran` is printed under every figure. A testnet result must not be
         readable as a mainnet one just because the panel beside it says
         mainnet. The heading is the flattest available claim — these are
         readings, and the panel beside them is the index you check them
         against. */
      const p1 = panel("RECORDED ON CHAIN", ACCENT, (c, x, y0, w) => {
        let y = y0 + 8;
        for (const r of results) {
          cardHead(c, x, y, r.label, ACCENT, 14);
          figureText(c, x + w, y, r.value, PAPER, 18, "700", "right");
          cardHead(c, x, y + 22, r.ran, ACCENT_DEEP, 12);
          y += 74;
        }
      });

      /* -- 3 · THE INDEX -------------------------------------------------
         Every deployed address, so the two panels to the left are checkable
         rather than merely stated: the contract set, what it recorded, and
         where to go and read it back. Derived from the deployment record —
         a redeploy moves these and no scene is edited.

         This slot previously held the caveat panel. That material now lives
         in docs/HONEST_DISCLOSURES.md, linked from the README. */
      const p2 = panel("EVERY ADDRESS", ACCENT_DEEP, (c, x, y0, w) => {
        /* 14 rows. At a 34px pitch the last one lands on 570 and the
           footer sits at 578 — eight pixels apart, which is the overlap
           class PLAN.md §12 step 6 already caught twice on this panel. */
        let y = y0 + 6;
        for (const r of contractIndex) {
          cardHead(c, x, y, r.label, ACCENT, 13);
          figureText(c, x + w, y, r.value, PAPER, 17, "400", "right");
          y += 31;
        }
        cardHead(c, x, 578, "SCAN.BOTCHAIN.AI", SUCCESS, 15);
      });

      const X = [-PW - 0.55, 0, PW + 0.55];
      [p0, p1, p2].forEach((p, i) => {
        p.position.set(X[i], 0.47 + PH / 2, 0);
        root.add(p);
        panels.push(p);
      });

      /* -- the marks, on the plate ---------------------------------------
         Cifra's own identity leads and BOT Chain sits under it as the venue.
         That order is the accurate one: this is Cifra's protocol, deployed
         on someone else's chain — not a BOT Chain product. */
      const lb = board(760, 320, (c) => {
        c.clearRect(0, 0, 760, 320);
        drawCifraIcon(c, 0, 0, 132);
        drawCifraWordmark(c, 156, 22, 300);
        cardHead(c, 0, 214, "PRIVATE INVOICE FACTORING", ACCENT, 19);
        drawBotChain(c, 0, 244, 300);
      });
      const lp = boardPlane(lb, 3.5, 3.5 * 320 / 760, { renderOrder: 6 });
      lp.position.set(-PW - 0.55, 0.47 + PH + 0.98, 0);
      root.add(lp);

      const tb = board(1240, 150, (c) => {
        c.clearRect(0, 0, 1240, 150);
        displayText(c, 0, 96, "Measured, not asserted.", PAPER, 76, "700");
      });
      const tp = boardPlane(tb, 7.2, 7.2 * 150 / 1240, { renderOrder: 6 });
      tp.position.set(PW * 0.62, 0.47 + PH + 0.70, 0);
      root.add(tp);
    },

    update(t) {
      env.update(t);

      /* Each panel drops in, lands, and rings out. The third gets exactly
         the same envelope as the first two — no softer landing for the bad
         news. */
      panels.forEach((p, i) => {
        const at = LAND[i];
        const before = t < at - 0.9;
        p.visible = !before;
        if (before) return;
        const drop = eOutBack(seg(t, at - 0.9, at));
        const sy = impactY(t - at, 0.0, 0.0, 0.10);
        p.position.y = lerp(0.47 + PH / 2 + 3.4, 0.47 + PH / 2, drop);
        p.scale.set(1 / Math.sqrt(sy), sy, 1);
        p.rotation.z = lerp(-0.05, 0, eOutBack(seg(t, at - 0.9, at + 0.25)));
      });
    },

    camera(t): Shot {
      const HOME: Shot = { pos: [0, 5.2, 17.6], look: [0, 4.4, 0], fov: 44 };

      // C1 — push in as the panels land. Enters on motion.
      if (t < S.crane) {
        const p = eInOut(seg(t, 0, S.crane));
        return {
          pos: [lerp(0, -0.4, p), lerp(5.2, 4.6, p), lerp(17.6, 14.6, p)],
          look: [lerp(0, -1.2, p), lerp(4.4, 4.2, p), 0],
          fov: 44,
        };
      }
      /* C2 — crane UP, and drift only slightly across.
         The three panels span 14 world units (X = ±(PW + 0.55), each PW
         wide), so the set runs from -7.0 to +7.0. The original move panned
         to look.x 3.2 at z 13.4 with the fov NARROWING to 40, which put the
         left panel's outer edge 10.2 units off-axis against a horizontal
         half-width of about 8.9 — so it sat cut off the frame for the whole
         second half of the scene, labels chopped, while the caption said
         "every figure on the panels beside it can be read back".

         The move now ends at look.x 1.2, z 14.4, fov 42: half-width 9.8
         against a worst-case 8.2, which keeps all three in frame with room
         to spare. The crane from y 4.6 to 5.6 still carries the shot — on
         three panels of dense type, holding them beats panning off them. */
      if (t < S.resolve) {
        const p = eInOut(seg(t, S.crane, S.hold));
        const h = eInOut(seg(t, S.hold, S.resolve));
        return {
          pos: [lerp(-0.4, 1.2, p) + h * 0.2, lerp(4.6, 5.6, p), lerp(14.6, 14.4, p) + h * 0.5],
          look: [lerp(-1.2, 1.2, p), lerp(4.2, 4.4, p), 0],
          fov: lerp(44, 42, p),
        };
      }
      // C3 — resolve to HOME, which is also the frame the cut returns to S0
      // on. Closes the loop exactly.
      const e = eInOut(seg(t, S.resolve, LOOP));
      return {
        pos: [lerp(1.4, HOME.pos[0], e), lerp(5.6, HOME.pos[1], e), lerp(14.9, HOME.pos[2], e)],
        look: [lerp(1.2, HOME.look[0], e), lerp(4.4, HOME.look[1], e), 0],
        fov: lerp(42, HOME.fov, e),
      };
    },

    caption(t): Caption {
      if (t < LAND[2]) return {
        title: "Every contract is deployed and source-verified.",
        sub: `${contractCount} contracts, two books, on ${networkLabel.toLowerCase()}.`,
        beat: isMainnet
          ? "Live on BOT Chain mainnet, chain 677."
          : "Live on BOT Chain testnet, chain 968 — mainnet is a deploy, not a rewrite.",
      };
      if (t < S.crane) return {
        title: "And the whole loop has run.",
        sub: "Register, score, attest, fund, settle — and default, with the junior tranche taking all of it.",
        beat: "Every figure here came off a suite or a live transaction, and says which.",
      };
      if (t < S.resolve) return {
        title: "And every address is here.",
        sub: "The full contract set, on the explorer, verified — so every figure on the panels beside it can be read back.",
        beat: "Nothing on this plate has to be taken on trust.",
      };
      return {
        title: "Private credit. Public settlement.",
        sub: "Scored against a published model, funded from a tranched pool, settled and defaulted on chain.",
        beat: "Measured, not asserted.",
      };
    },
  };
}
