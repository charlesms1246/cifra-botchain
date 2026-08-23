/* S6 · GOVERNANCE — PLAN.md §5.
   ─────────────────────────────────────────────────────────────────────────
   Line: no lever moves on one signature.

   A 2-of-3 Safe is a threshold, and a threshold is the one governance fact
   that can be shown instead of stated: one key turns and NOTHING HAPPENS.
   That refusal is the scene. The second key is what makes the lever throw,
   and the parameter it changes flips on the frame the lever lands — a state
   swap, not a tween, because §7 rule 2 does not stop applying to a number
   just because it is a config value.

   THE HONEST HALF. Six of the seven owner-bearing contracts read the Safe
   as their owner; the funder registry still reads the deployer key. Both
   were read off chain 677 on 2026-08-22, and both are on the rack — the
   sixth plate bolts to the Safe and the seventh does not, in the same shot.
   A governance scene that showed only the part that went well would be the
   one thing this deck has spent six scenes not being.

   AND WHAT GOVERNANCE CANNOT REACH. The grace period is `immutable` in
   `CifraSettlement`, and `CifraTrancheVault._withdraw` is deliberately
   never gated. Two plates that stay bolted shut while the lever is thrown —
   which is a stronger claim than the levers themselves, because a protocol
   is defined at least as much by what its owner cannot do.

   Loop 34s. */

import * as THREE from "three";
import type { Scene3D, Shot, Caption } from "../engine";
import { gridFloor, obox, glowSprite } from "../voxel";
import { board, boardPlane, cardHead, figureText } from "../board";
import { css, INK, PAPER, ACCENT, ACCENT_DEEP, ACCENT_LIGHT, SUCCESS, WARNING, LOSS, STEEL, STEEL_DARK, STEEL_LIGHT } from "../palette";
import { makeEnvironment, type EnvHandle } from "../env";
import { makeFigure, type FigureHandle } from "../cast/figure";
import { govSafe, govSafeTx, govThreshold, govOwners, govHeld, govPending, shortAddr, shortTx, graceDays } from "../deck-data";
import { seg, eInOut, eOutBack, eOutCubic, ring, lerp, impactY } from "../craft";

const LOOP = 34;

const S = {
  /* ONE KEY. It turns, it holds, and the lever does not move. The hold is
     the beat — a refusal read as a refusal only if the frame sits on it. */
  key1: 3.2, key1At: 4.4,
  denied: 5.4,          // the lever refuses, visibly
  /* TWO. */
  key2: 8.2, key2At: 9.4,
  throw_: 10.6,         // the lever lands — the parameter flips HERE
  /* The rack: who owns what. */
  rack: 14.6,
  bolt: 16.2,           // six plates bolt to the Safe
  pending: 19.4,        // and the seventh does not
  /* What the Safe cannot touch. */
  fixed: 23.6,
  resolve: 29.6,
};

const SAFE_X = 0;
const DESK_Z = 0.4;
/** The two signers, OUTBOARD of the safe's own width so they frame it
 *  rather than stand on it. The safe spans x ±2.3. */
const SIGN_X = 4.25;
/** The keyholes sit downstage of the safe's front face, not inside it. */
const KEY_Z = DESK_Z + 2.15;

/* The rack of owned contracts, upstage. Six across one row keeps every
   plate the same size as the seventh — which is the point of the beat. */
const RACK_Z = -5.6;
const RACK_Y = 2.35;

export function s6Governance(): Scene3D {
  let env: EnvHandle;
  let lever: THREE.Group;
  let leverArm: THREE.Mesh;
  let paramBoard: ReturnType<typeof board>;
  let denyGlow: THREE.Sprite;
  let signerA: FigureHandle;
  let signerB: FigureHandle;
  const keys: THREE.Group[] = [];
  const heldPlates: THREE.Mesh[] = [];
  const heldBolts: THREE.Mesh[] = [];
  let pendingPlate: THREE.Mesh;
  let pendingBolt: THREE.Mesh;
  let fixedRig: THREE.Group;
  const signerPlates: THREE.Mesh[] = [];
  let safePlate: THREE.Mesh;
  let flipped = false;

  /** A key in its barrel: the barrel stays, the key turns. */
  function keyPost(parent: THREE.Object3D, x: number, accent: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, 0, KEY_Z);
    parent.add(g);
    obox(g, 0.62, 0.22, 0.62, STEEL_DARK, 0, 0.11, 0, { outlineThickness: 0.05 });
    obox(g, 0.34, 0.86, 0.34, STEEL, 0, 0.65, 0, { outlineThickness: 0.05 });
    const turn = new THREE.Group();
    turn.position.set(0, 1.18, 0);
    g.add(turn);
    // the bit, sticking out sideways — so a quarter turn is unmistakable
    obox(turn, 0.20, 0.20, 0.20, accent, 0, 0, 0, { outlineThickness: 0.045 });
    obox(turn, 0.86, 0.15, 0.15, accent, 0.45, 0, 0, { outlineThickness: 0.045 });
    keys.push(turn);
    return g;
  }

  return {
    loop: LOOP,

    build(root) {
      env = makeEnvironment(root, { kind: "freight", density: 0.7, motes: 7, seed: 131, loop: LOOP });
      gridFloor(root, 70, ACCENT, 0.08);

      /* -- the Safe: one heavy block, and it is the only thing on stage that
            looks like it weighs anything. Two keyholes on its face. */
      const safe = new THREE.Group();
      safe.position.set(SAFE_X, 0, DESK_Z);
      root.add(safe);
      obox(safe, 4.6, 0.36, 2.4, STEEL_DARK, 0, 0.18, 0, { outlineThickness: 0.07 });
      obox(safe, 4.0, 1.5, 1.9, STEEL, 0, 1.11, 0, { outlineThickness: 0.07 });
      obox(safe, 3.4, 0.20, 0.16, STEEL_DARK, 0, 1.90, 0, { outlineThickness: 0.05 });

      const sb = board(900, 260, (c) => {
        c.clearRect(0, 0, 900, 260);
        cardHead(c, 4, 52, "GOVERNANCE SAFE", PAPER, 30);
        figureText(c, 4, 132, shortAddr(govSafe), ACCENT_LIGHT, 34, "700");
        cardHead(c, 4, 196, `${govThreshold} OF ${govOwners} · SAFE 1.4.1`, SUCCESS, 24);
        /* The CONSEQUENCE of the threshold on the line above, which is what
           the scene then spends ten seconds showing: one key turns and the
           lever does not move. Phrased as verifyGov.ts phrases the same
           assertion, so the plate and the gate that checks it agree.

           This replaced "KEYS ON THREE SEPARATE DEVICES" — a claim about
           custody rather than about the contract, unverifiable from chain,
           and untrue on the day it was written, sitting directly under a
           real Safe address. The first replacement restated the threshold
           and simply said the line above twice; a plate that repeats itself
           spends a line and buys nothing. */
        cardHead(c, 4, 240, "NO SINGLE SIGNER CAN ACT", ACCENT_DEEP, 19);
      });
      const sp = boardPlane(sb, 3.4, 3.4 * 260 / 900, { renderOrder: 5 });
      sp.position.set(0, 1.20, 0.98);
      safe.add(sp);
      safePlate = sp;

      /* Outboard of the safe's own plate (x ±1.7). At ±1.5 the barrels stood
         across its bottom line and ate the words "KEYS ON". */
      keyPost(root, -2.55, SUCCESS);
      keyPost(root, 2.55, SUCCESS);

      /* -- the handle the keys arm ---------------------------------------
         ON the safe, not beside it. A free-standing lever needed floor space
         between the two keyholes and there is none: it collided with the
         right-hand barrel, and moving it outboard put it behind a signer.
         Mounting it on the box it opens is also the truer picture — the two
         keys and the thing they release are one mechanism. */
      lever = new THREE.Group();
      lever.position.set(SAFE_X, 0, DESK_Z);
      root.add(lever);
      obox(lever, 0.52, 0.22, 0.52, STEEL_DARK, 0, 2.05, 0, { outlineThickness: 0.055 });
      leverArm = obox(lever, 0.18, 0.92, 0.18, LOSS, 0, 2.62, 0, { outlineThickness: 0.05 });
      /* The grip is a CHILD of the arm. As a sibling it stayed put while the
         arm swung under it, which reads as the handle coming off. */
      obox(leverArm, 0.34, 0.34, 0.34, PAPER, 0, 0.52, 0, { outlineThickness: 0.05 });

      /* The parameter the lever changes. A real one: `setSeniorYieldShareBps`
         is the split S5 spends its first half proving, so moving it here is
         the same fact from the other side. */
      /* 240 tall, not 190: the executed state adds the transaction hash on
         its OWN line. Right-aligned onto the status line it sat dim and
         orphaned at the far edge of the board, and at this camera distance
         it was not legible at all — which for the one checkable thing in
         the scene is the same as not printing it. */
      paramBoard = board(760, 240, (c) => {
        c.clearRect(0, 0, 760, 240);
        cardHead(c, 4, 46, "SETSENIORYIELDSHAREBPS", PAPER, 22);
        figureText(c, 4, 128, "5000", PAPER, 52, "700");
        cardHead(c, 4, 178, "ONE SIGNATURE — NOT EXECUTED", LOSS, 18);
      });
      const pp = boardPlane(paramBoard, 2.6, 2.6 * 240 / 760, { renderOrder: 5 });
      pp.position.set(0, 3.86, 0.12);
      lever.add(pp);

      denyGlow = glowSprite(LOSS, 2.6, 0);
      denyGlow.position.set(SAFE_X, 2.7, DESK_Z + 0.3);
      root.add(denyGlow);

      /* -- the signers ---------------------------------------------------
         Two of three. The third is not on stage and is not implied to be:
         nothing here says where they are, because the deck does not know. */
      signerA = makeFigure(root, "factor", { accent: SUCCESS });
      signerA.g.position.set(-SIGN_X, 0, KEY_Z + 0.15);
      signerA.face(0.46);

      signerB = makeFigure(root, "factor", { accent: SUCCESS });
      signerB.g.position.set(SIGN_X, 0, KEY_Z + 0.15);
      signerB.face(-0.46);

      for (const [fig, label] of [[signerA, "SIGNER 1"], [signerB, "SIGNER 2"]] as
        [FigureHandle, string][]) {
        const lb = board(440, 90, (c) => {
          c.clearRect(0, 0, 440, 90);
          cardHead(c, 4, 58, label, PAPER, 26);
        });
        const lp = boardPlane(lb, 1.5, 1.5 * 90 / 440, { renderOrder: 5 });
        lp.position.set(0, 2.86, -0.14);
        /* Counter-rotated out of the figure's frame — the same fix S4's
           funder plates needed, for the same reason. */
        lp.rotation.y = -fig.g.rotation.y;
        fig.g.add(lp);
        signerPlates.push(lp);
      }

      /* -- the rack: who owns what -------------------------------------- */
      const N = govHeld.length;
      const PW = 2.05, GAP = 0.30;
      const span = (N + 1) * PW + N * GAP;
      const x0 = -span / 2 + PW / 2;

      const ownerPlate = (label: string, address: string, owner: string, accent: number): THREE.Mesh => {
        const b = board(420, 250, (c) => {
          c.fillStyle = css(INK);
          c.fillRect(0, 0, 420, 250);
          c.strokeStyle = css(accent);
          c.lineWidth = 5;
          c.strokeRect(2.5, 2.5, 415, 245);
          c.fillStyle = css(accent);
          c.fillRect(0, 0, 420, 10);
          cardHead(c, 20, 62, label, PAPER, 19);
          /* The address, under the name it belongs to. This plate says which
             contract answers to what — mechanism, not status — so it is one
             of the plates an address may go on. */
          figureText(c, 20, 104, address, ACCENT_DEEP, 17, "400");
          cardHead(c, 20, 150, "OWNER", ACCENT_DEEP, 15);
          cardHead(c, 20, 188, owner, accent, 20);
        });
        return boardPlane(b, PW, PW * 250 / 420, { transparent: false, renderOrder: 5 });
      };

      govHeld.forEach((row, i) => {
        const pl = ownerPlate(row.label, row.value, "SAFE", SUCCESS);
        pl.position.set(x0 + i * (PW + GAP), RACK_Y, RACK_Z);
        root.add(pl);
        heldPlates.push(pl);
        // the bolt that fixes it to the Safe — it lands ON the beat
        const bolt = obox(root, 0.26, 0.26, 0.26, SUCCESS,
          pl.position.x, RACK_Y - PW * 250 / 420 / 2 - 0.24, RACK_Z + 0.1,
          { outlineThickness: 0.05 });
        heldBolts.push(bolt);
      });

      /* The seventh. Same size, same row, same weight — a plate shrunk into
         a footnote is the footnote version of the same dishonesty §7 rule 6
         is about. */
      pendingPlate = ownerPlate(govPending.label, govPending.value, "DEPLOYER KEY", WARNING);
      pendingPlate.position.set(x0 + N * (PW + GAP), RACK_Y, RACK_Z);
      root.add(pendingPlate);
      pendingBolt = obox(root, 0.26, 0.26, 0.26, WARNING,
        pendingPlate.position.x, RACK_Y - PW * 250 / 420 / 2 - 0.24, RACK_Z + 0.1,
        { outlineThickness: 0.05 });

      /* -- what governance cannot reach ----------------------------------
         Downstage, bolted shut, and they do not move when the lever does. */
      fixedRig = new THREE.Group();
      fixedRig.position.set(0, 0, DESK_Z + 4.9);
      root.add(fixedRig);
      const fixedPlate = (label: string, detail: string, x: number): void => {
        const b = board(560, 220, (c) => {
          c.fillStyle = css(INK);
          c.fillRect(0, 0, 560, 220);
          c.strokeStyle = css(ACCENT);
          c.lineWidth = 5;
          c.strokeRect(2.5, 2.5, 555, 215);
          cardHead(c, 22, 58, "NO KEY REACHES THIS", ACCENT_DEEP, 16);
          cardHead(c, 22, 118, label, PAPER, 26);
          cardHead(c, 22, 176, detail, ACCENT, 17);
        });
        const pl = boardPlane(b, 2.35, 2.35 * 220 / 560, { transparent: false, renderOrder: 5 });
        pl.position.set(x, 1.42, 0);
        fixedRig.add(pl);
        // a shut bolt either side, so it reads as fixed rather than as a sign
        for (const sx of [-1, 1]) {
          obox(fixedRig, 0.20, 0.20, 0.20, STEEL_LIGHT, x + sx * 1.36, 1.42, 0.06,
            { outlineThickness: 0.05 });
        }
      };
      fixedPlate("GRACE PERIOD", `${graceDays} DAYS · IMMUTABLE`, -1.72);
      fixedPlate("REDEMPTION", "WITHDRAW IS NEVER GATED", 1.72);
      fixedRig.visible = false;
    },

    update(t) {
      env.update(t);

      /* ── the keys ──────────────────────────────────────────────────
         A quarter turn each, and they STAY turned. A key that springs back
         would say the signature expired, which is not what a Safe does. */
      keys[0].rotation.z = -1.57 * eOutBack(seg(t, S.key1, S.key1At));
      keys[1].rotation.z = -1.57 * eOutBack(seg(t, S.key2, S.key2At));

      /* ── the lever ─────────────────────────────────────────────────
         Between one key and two it is PULLED AT and does not give: a short
         hard shudder, damped, off the known refusal time. Nothing else in
         the deck shakes without moving, which is the point — the frame has
         to feel the refusal or the caption is carrying it alone. */
      const denied = t >= S.denied && t < S.key2At;
      const shove = denied ? ring(t - S.denied, 0.16, 13, 22) : 0;
      const thrown = eOutBack(seg(t, S.throw_ - 0.35, S.throw_ + 0.2));
      leverArm.rotation.x = thrown * 1.15 + shove * 0.10;
      const armed = t >= S.key2At;
      (leverArm.material as THREE.MeshToonMaterial).color.setHex(armed ? SUCCESS : LOSS);
      denyGlow.material.opacity = denied
        ? 0.6 * Math.max(0, 1 - (t - S.denied) / 0.9) : 0;

      /* The parameter flips ON the frame the lever lands. One state to the
         next, never a count between them (§7 rule 2). */
      const nowFlipped = t >= S.throw_;
      if (nowFlipped !== flipped) {
        flipped = nowFlipped;
        paramBoard.redraw((c) => {
          c.clearRect(0, 0, 760, 240);
          cardHead(c, 4, 46, "SETSENIORYIELDSHAREBPS", PAPER, 22);
          figureText(c, 4, 128, flipped ? "6000" : "5000", flipped ? SUCCESS : PAPER, 52, "700");
          cardHead(c, 4, 178,
            flipped ? "TWO SIGNATURES — EXECUTED" : "ONE SIGNATURE — NOT EXECUTED",
            flipped ? SUCCESS : LOSS, 18);
          /* The caption over this beat says a real Safe transaction was
             executed on mainnet before the handover. It was — this hash,
             two signatures, status 1, at block 20,532,427, with ownership
             transferring thirty-odd blocks later. Printing it is what turns
             that sentence from a claim into something a viewer can check.
             The PARAMETER above is illustrative; the transaction is not. */
          if (flipped) figureText(c, 4, 222, shortTx(govSafeTx), ACCENT, 22, "400");
        });
      }

      /* ── the signers ──────────────────────────────────────────────── */
      signerA.express(t >= S.key1 ? "alert" : "neutral");
      signerB.express(t >= S.throw_ ? "pleased" : t >= S.denied && t < S.key2 ? "worry" : "neutral");
      signerA.update(t, 0);
      signerB.update(t, 0);

      /* The handle and its parameter plate are struck on the cut to the
         rack. Left standing, the grip rose straight through the fourth
         contract plate and the 6000 hung over the row — a prop whose beat is
         over occluding the one that follows, which is the mistake this deck
         has now made in three scenes. */
      lever.visible = t < S.rack;
      /* Their names go with it. On the rack shot the two cards sat at almost
         exactly the plates' height and SIGNER 2 landed inside the seventh
         one — the one plate in the scene that has to be read on its own. */
      for (const lp of signerPlates) lp.visible = t < S.rack;

      /* ── the rack ──────────────────────────────────────────────────
         Six plates drop and their bolts land under them. The seventh drops
         with the rest and its bolt never closes — it hangs, low and open. */
      heldPlates.forEach((pl, i) => {
        const at = S.bolt + i * 0.16;
        const on = t >= S.rack;
        pl.visible = on;
        heldBolts[i].visible = t >= at;
        if (!on) return;
        const drop = eOutBack(seg(t, S.rack + i * 0.1, S.rack + 0.7 + i * 0.1));
        pl.position.y = lerp(RACK_Y + 2.4, RACK_Y, drop);
        const sy = impactY(t - (S.rack + 0.7 + i * 0.1), 0.0, 0.0, 0.09);
        pl.scale.set(1 / Math.sqrt(sy), sy, 1);
        heldBolts[i].scale.setScalar(eOutBack(seg(t, at, at + 0.3)));
      });

      const showPending = t >= S.pending;
      pendingPlate.visible = showPending;
      pendingBolt.visible = showPending;
      if (showPending) {
        const drop = eOutBack(seg(t, S.pending, S.pending + 0.7));
        pendingPlate.position.y = lerp(RACK_Y + 2.4, RACK_Y, drop);
        const sy = impactY(t - (S.pending + 0.7), 0.0, 0.0, 0.09);
        pendingPlate.scale.set(1 / Math.sqrt(sy), sy, 1);
        /* The bolt hangs OPEN — below its seat and turned. Not missing:
           missing reads as an oversight in the drawing, and this is a
           deliberate, disclosed state. */
        pendingBolt.scale.setScalar(eOutBack(seg(t, S.pending + 0.3, S.pending + 0.6)));
        pendingBolt.position.y = RACK_Y - 1.06 - 0.30 * eOutCubic(seg(t, S.pending + 0.5, S.pending + 1.1));
        pendingBolt.rotation.z = 0.7 * eOutCubic(seg(t, S.pending + 0.5, S.pending + 1.1));
      }

      /* ── and what no key reaches ────────────────────────────────────
         The safe's own card goes as these arrive. It has held the address
         and the threshold for twenty-three seconds; leaving it up put two
         of its lines in the gap between the two plates standing in front of
         it, which is type over type and reads as a rendering fault. */
      fixedRig.visible = t >= S.fixed;
      safePlate.visible = t < S.fixed;
    },

    camera(t): Shot {
      const HOME: Shot = { pos: [0, 4.0, 13.4], look: [0, 1.9, 0], fov: 40 };

      // C0 — the Safe and both keys, wide enough to hold the two signers.
      if (t < S.key2) {
        const p = eInOut(seg(t, 0, S.key2));
        return {
          pos: [lerp(-0.8, 0.4, p), lerp(5.2, 4.8, p), lerp(17.8, 16.2, p)],
          look: [lerp(-0.2, 0.4, p), lerp(2.1, 2.0, p), lerp(1.0, 1.2, p)],
          fov: 40,
        };
      }
      // ── CUT ── C1 — the lever. The second key, the throw, the parameter.
      if (t < S.rack) {
        const p = eInOut(seg(t, S.key2, S.rack));
        const k = t >= S.throw_ ? ring(t - S.throw_, 0.10, 9, 24) : 0;
        return {
          /* Back far enough to hold the two keys, the lever and the plate
             above it in one frame: at 11 units the safe filled the shot and
             the lever — the thing the beat is about — was outside it. */
          /* Centred, and back far enough to hold the two barrels, the handle
             and the plate above it in one frame. */
          pos: [lerp(1.4, 1.0, p) + k * 0.4, lerp(5.4, 5.2, p) + k, lerp(15.0, 13.8, p)],
          look: [lerp(0.3, 0.1, p), lerp(2.5, 2.4, p) + k * 0.5, lerp(1.2, 1.0, p)],
          fov: 36,
        };
      }
      // ── CUT ── C2 — the rack, wide. Seven plates, one frame: the count is
      // the argument, and a count you have to pan across is not a count.
      if (t < S.fixed) {
        const p = eInOut(seg(t, S.rack, S.fixed));
        return {
          pos: [0, lerp(3.4, 3.2, p), lerp(11.6, 10.6, p)],
          look: [0, lerp(2.5, 2.4, p), RACK_Z],
          fov: lerp(46, 44, p),
        };
      }
      // ── CUT ── C3 — downstage, on the two things no key reaches, then out
      // to HOME so the cut into S7 lands on a wide.
      const e = eInOut(seg(t, S.resolve, LOOP));
      const p = eInOut(seg(t, S.fixed, S.resolve));
      return {
        /* Back far enough that the two plates are two plates. At 12 units
           they were each a third of the frame and stood across the safe's
           own address — the shot said "no key reaches this" while covering
           the key-holder it was talking about. */
        pos: [0,
        lerp(lerp(4.2, 4.0, p), HOME.pos[1], e),
        lerp(lerp(16.4, 15.4, p), HOME.pos[2], e)],
        look: [0, lerp(lerp(2.1, 2.0, p), HOME.look[1], e), lerp(lerp(4.0, 4.4, p), HOME.look[2], e)],
        fov: lerp(lerp(38, 36, p), HOME.fov, e),
      };
    },

    caption(t): Caption {
      if (t < S.denied) return {
        title: "Nothing here is owned by one key.",
        sub: `A ${govThreshold}-of-${govOwners} Safe owns the protocol. Every parameter change is a multisig transaction.`,
        beat: "One signer turns their key.",
      };
      if (t < S.key2At) return {
        title: "And one signature does nothing.",
        sub: "The threshold is not a policy or a convention — it is the contract refusing to execute.",
        beat: "The lever will not move.",
      };
      if (t < S.rack) return {
        title: "Two, and it moves.",
        sub: "The senior share of the yield — the split the waterfall runs on — changed by governance, not by a key.",
        beat: "This is a real Safe transaction, executed on mainnet before the handover.",
      };
      if (t < S.pending) return {
        title: "Six contracts answer to it.",
        sub: "The registry, the attestation NFT, and both books' controller and settlement.",
        beat: "Ownership was read back off chain, not assumed from the transaction that set it.",
      };
      if (t < S.fixed) return {
        title: "And one does not, yet.",
        sub: "The funder registry still answers to the deployer key. It is one transaction from the Safe, and it has not been sent.",
        beat: "Shown at the same size as the six, because that is the only version worth showing.",
      };
      return {
        title: "Some things no key reaches.",
        sub: `The grace period is immutable at ${graceDays} days. Redemption is never gated, for anyone, by anything.`,
        beat: "A protocol is defined as much by what its owner cannot do.",
      };
    },
  };
}
