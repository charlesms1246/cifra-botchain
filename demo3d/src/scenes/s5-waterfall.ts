/* S5 · THE WATERFALL — PLAN.md §5. The money shot.
   ─────────────────────────────────────────────────────────────────────────
   Line: junior first, always.

   Two halves and one hard cut between them. Settle, then default. The payoff
   frame is the crane at the end that holds the EMPTY junior basin and the
   UNTOUCHED senior basin in the same shot — that single frame is the entire
   subordination argument, and everything before it exists to set it up.

   §7 rule 5 binds this scene specifically. The grade-A default on MAINNET
   677 saw the junior tranche absorb the ENTIRE loss with senior untouched:
   BOT 0.0208 → 0.002, USDT 0.52 → 0.05 (SESSION_CLOSURE.md). So senior does
   not move a pixel — and junior drains to the 9.6% it actually kept, not to
   zero. Draining it dry is the better frame and the false one; the earlier
   pass did exactly that, off a testnet run, and it would have overstated a
   number the deck's own closing plate now prints.

   §7 rule 2 also bites here in a non-obvious way: the grace period is shown
   as a DEPLETING BAR with a static label, not as counting numerals. A
   count-down is a number animating toward a value, and while a clock is not
   a claim about money, the deck does not get to keep two rules about
   animated figures. One rule, applied everywhere.

   Loop 34s. Everything below is a function of ph = t. */

import * as THREE from "three";
import type { Scene3D, Shot, Caption } from "../engine";
import { gridFloor, obox, flat, glowSprite } from "../voxel";
import { board, boardPlane, cardHead, figureText } from "../board";
import { INK, PAPER, ACCENT, ACCENT_DEEP, ACCENT_LIGHT, SUCCESS, WARNING, LOSS, STEEL, STEEL_DARK } from "../palette";
import { makeEnvironment, type EnvHandle } from "../env";
import { makeBasins, type BasinsHandle } from "../cast/basins";
import { makeInvoice, type InvoiceHandle } from "../cast/invoice";
import { makeFigure, type FigureHandle } from "../cast/figure";
import { juniorLeftAfterDefault, addr, shortAddr, graceDays } from "../deck-data";
import { seg, eInOut, eOutBack, eOutCubic, eInCubic, lerp, arc, impactY } from "../craft";

const LOOP = 38;
const LOOP_END = 38;

/* ── the schedule. Every beat is a constant, so every transient (impact
      envelopes, kicks) is analytic and the capture reproduces. ──────────── */
const S = {
  /* SETTLE */
  payFly: 2.0, payLand: 3.2,        // repayment travels in and lands
  principal: 3.4,                    // face value returns to the pool
  yield: 5.0,                        // the 50/50 split lands
  stamped: 6.4,                      // slab -> settled

  /* THE EXIT. The senior funder is REMOVED from the allowlist and redeems
     anyway. `CifraTrancheVault` gates deposits (`canHold`) and transfers
     (`_update`) but deliberately never gates `_withdraw`: "a compliance
     control that traps capital is a worse problem than the one it solves."
     This was proven live on testnet and it is the deck's answer to the
     securities question S4 raises. */
  delist: 9.6,
  redeemOut: 11.0, redeemIn: 12.4,
  settleHold: 7.2,

  /* HARD CUT */
  cut: 19.0,

  /* STAGE RISERS — one subject on stage at a time.
     The funders and the buyer share the right of this stage, and with all
     three standing there at once the senior funder clipped straight through
     the rig's post and into the junior tank. Rather than shuffle positions
     until nothing intersects, they take turns: the buyer is up to pay, goes
     down, and the funders rise for the yield split. It fixes the collision
     and it enforces CRAFT.md's one-idea-per-beat at the same time. */
  buyerDown0: 3.6, buyerDown1: 4.7,
  fundersUp0: 4.3, fundersUp1: 5.4,
  fundersDown0: 35.2, fundersDown1: 36.4,
  buyerUp0: 36.6, buyerUp1: LOOP_END,

  /* DEFAULT */
  /* WHO CALLS IT. `markDefault` is permissionless — "after
     `dueDate + GRACE_PERIOD` the absence of a payment is directly
     observable". The scene said "anyone at all may call it" and then had
     nobody call it; the grace bar simply expired and the loss appeared.
     Now someone with no stake in the invoice walks up and pulls the lever,
     and the lever is LOCKED until the grace period is actually over,
     because calling early reverts. */
  callerIn: 21.4, callerAt: 24.0,
  graceStart: 20.2, graceEnd: 24.6,  // the bar depletes
  lossEnter: 25.4,                   // loss enters junior
  juniorEmpty: 27.4,                 // junior at its floor — see JUNIOR_AFTER
  craneUp: 29.0,                     // frame both basins
  resolve: 35.0,
};

/* Levels. Post-funding the book is deployed; repayment restores principal
   and then adds yield. The two yield increments are IDENTICAL and land on
   the same frame — that simultaneity is the 50/50 claim, shown not stated. */
const L0 = 0.54;          // deployed
const L_PRINCIPAL = 0.74; // principal back
const L_YIELD = 0.80;     // + yield
/** Where junior lands after the default — the measured residue, not zero. */
const JUNIOR_AFTER = L0 * juniorLeftAfterDefault;

/** A platform a figure stands on, so the figure can be taken off stage by
 *  lowering it rather than by being moved somewhere it fits. */
function riser(root: THREE.Object3D, x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  root.add(g);
  obox(g, 1.5, 0.30, 1.5, STEEL_DARK, 0, -0.15, 0, { outlineThickness: 0.06 });
  obox(g, 1.18, 0.07, 1.18, ACCENT_DEEP, 0, 0.02, 0, { outlineThickness: 0.05 });
  return g;
}

export function s5Waterfall(): Scene3D {
  let env: EnvHandle;
  let basins: BasinsHandle;
  let invoice: InvoiceHandle;
  let payment: THREE.Group;
  let graceFill: THREE.Mesh;
  let graceMat: THREE.MeshBasicMaterial;
  let graceLabel: THREE.Mesh;
  let lossBolt: THREE.Sprite;
  let graceBoard: ReturnType<typeof board>;
  let supplier: FigureHandle;
  let seniorFunder: FigureHandle;
  let juniorFunder: FigureHandle;
  let buyer: FigureHandle;
  let seniorRise: THREE.Group;
  let juniorRise: THREE.Group;
  let buyerRise: THREE.Group;
  let buyerPlate: THREE.Mesh;
  let redeem: THREE.Group;
  let graceRig: THREE.Group;
  let lever: THREE.Group;
  let leverArm: THREE.Mesh;
  let leverBoard: ReturnType<typeof board>;
  let caller: FigureHandle;
  let armed = false;
  let seniorBoard: ReturnType<typeof board>;
  let delisted = false;

  const BASIN_X = 2.4;
  const BUYER_X = BASIN_X + 6.9;
  /* The repayment leaves the BUYER'S HANDS. It used to fly in from off-stage
     right, which meant the one transaction the scene is about had no source
     — money appearing from nowhere, in a deck whose whole argument is that
     you can see where every movement came from. */
  const PAY_FROM = new THREE.Vector3(BUYER_X - 0.5, 1.35, 1.0);
  const PAY_TO = new THREE.Vector3(BASIN_X, 3.15, 1.4);

  return {
    loop: LOOP,

    build(root) {
      env = makeEnvironment(root, { kind: "freight", density: 0.7, motes: 7, seed: 11, loop: LOOP });
      gridFloor(root, 60, ACCENT, 0.085);

      basins = makeBasins(root, { book: "BOT" });
      basins.g.position.set(BASIN_X, 0, 0);
      basins.setLevel("senior", L0);
      basins.setLevel("junior", L0);

      invoice = makeInvoice(root, { buyer: "ACME CORP", amount: "26,480.00", hash: "0x8f2c…41ab" });
      invoice.g.position.set(-4.6, 0, 1.0);
      invoice.g.rotation.y = 0.30;
      invoice.setGrade("B");
      invoice.setState("funded");

      /* -- the repayment: a slab of the book's own token ---------------- */
      payment = new THREE.Group();
      root.add(payment);
      obox(payment, 0.92, 0.92, 0.30, SUCCESS, 0, 0, 0, { outlineThickness: 0.055 });
      const pb = board(260, 260, (c) => {
        c.clearRect(0, 0, 260, 260);
        cardHead(c, 20, 54, "REPAID", INK, 26);
        figureText(c, 20, 150, "BOT", INK, 62, "700");
        cardHead(c, 20, 216, "ON CHAIN", INK, 20);
      });
      const pp = boardPlane(pb, 0.80, 0.80, { renderOrder: 5 });
      pp.position.set(0, 0, 0.16);
      payment.add(pp);
      payment.visible = false;

      /* -- the grace bar ------------------------------------------------
         A physical bar that depletes, with a static label. See the header
         on why this is not a counting clock. */
      /* The grace apparatus lives in ONE group so it can be struck for the
         settle half. Its housing was built straight onto `root` while only
         the fill and the label were toggled, so a dark bar hung across the
         settled-invoice shot belonging to a beat fifteen seconds away. */
      graceRig = new THREE.Group();
      root.add(graceRig);
      /* ABOVE the invoice's head and to the LEFT of the lever, not sharing
         a column with either. At gy 2.2 the housing sat on the slab's top
         edge and the label ran across its face — the countdown printed over
         the document it is counting down. */
      const gx = -4.2, gy = 2.85, gw = 3.0;
      obox(graceRig, gw + 0.16, 0.42, 0.14, STEEL_DARK, gx, gy, 2.4, { outlineThickness: 0.05 });
      graceMat = flat(WARNING);
      graceFill = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.26, 0.06), graceMat);
      graceFill.geometry.translate(gw / 2, 0, 0);   // anchor at the left end
      graceFill.position.set(gx - gw / 2, gy, 2.49);
      graceRig.add(graceFill);

      graceBoard = board(720, 152, (c) => {
        c.clearRect(0, 0, 720, 152);
        /* Derived, not typed. S6 already reads graceDays off the deployment
           record; this plate said "14" as a literal, so the two would have
           disagreed the moment the constant changed — and only one of them
           would have been wrong on screen. */
        cardHead(c, 4, 44, `DUE + ${graceDays} DAYS GRACE`, WARNING, 26);
        cardHead(c, 4, 92, "BLOCK.TIMESTAMP · ANYONE MAY CALL", PAPER, 18);
        /* The contract that observes the payment and the deadline. The beat
           here is "the settlement is the transaction" — this names which
           transaction. Mechanism, not status. */
        cardHead(c, 4, 134, `CIFRASETTLEMENT ${shortAddr(addr.botSettlement).toUpperCase()}`, ACCENT_DEEP, 17);
      });
      graceLabel = boardPlane(graceBoard, 2.5, 2.5 * 152 / 720, { renderOrder: 5 });
      graceLabel.position.set(gx - 0.24, gy + 0.52, 2.49);
      graceRig.add(graceLabel);
      graceRig.visible = false;

      /* -- the redemption ------------------------------------------------
         FOUR blocks out against the three a funder puts in in S4 — the gain
         stated by geometry, never by a figure counting up (§7 rule 2). */
      redeem = new THREE.Group();
      root.add(redeem);
      for (let i = 0; i < 4; i++) {
        obox(redeem, 0.86, 0.16, 0.60, ACCENT_LIGHT, 0, 0.10 + i * 0.19, 0, { outlineThickness: 0.05 });
      }
      redeem.visible = false;

      /* -- the call lever ------------------------------------------------ */
      lever = new THREE.Group();
      lever.position.set(-1.4, 0, 2.5);
      lever.visible = false;
      root.add(lever);
      obox(lever, 0.9, 0.30, 0.9, STEEL_DARK, 0, 0.15, 0, { outlineThickness: 0.06 });
      obox(lever, 0.24, 1.25, 0.24, STEEL, 0, 0.92, 0, { outlineThickness: 0.055 });
      leverArm = obox(lever, 0.16, 0.78, 0.16, LOSS, 0, 1.92, 0, { outlineThickness: 0.05 });
      obox(lever, 0.30, 0.30, 0.30, PAPER, 0, 2.34, 0, { outlineThickness: 0.05 });

      const vb = board(660, 190, (c) => {
        c.clearRect(0, 0, 660, 190);
        cardHead(c, 4, 46, "MARKDEFAULT()", PAPER, 25);
        cardHead(c, 4, 98, "LOCKED", LOSS, 27);
        cardHead(c, 4, 148, "UNTIL DUE + GRACE", PAPER, 16);
      });
      leverBoard = vb;
      const vp = boardPlane(vb, 2.1, 2.1 * 190 / 660, { renderOrder: 5 });
      vp.position.set(0, 2.75, 0.1);
      lever.add(vp);

      /* In from downstage-RIGHT and out to the LEFT — one direction, one
         crossing. Walking in from the left took them straight across the
         face of the defaulting invoice and parked their plate on it. */
      caller = makeFigure(root, "passerby");
      caller.g.position.set(1.9, 0, 2.7);
      caller.face(-1.35);

      const cb = board(640, 160, (c) => {
        c.clearRect(0, 0, 640, 160);
        cardHead(c, 4, 46, "ANY ADDRESS", PAPER, 25);
        cardHead(c, 4, 100, "NO STAKE IN THIS INVOICE", ACCENT, 17);
      });
      const cp = boardPlane(cb, 2.0, 2.0 * 160 / 640, { renderOrder: 5 });
      /* Lower than the lever's own card, and they stop far enough from it
         that the two never stack: two dark cards at the same height half a
         metre apart read as one block of type with a seam in it. */
      cp.position.set(0, 2.10, 0.1);
      /* Counter-rotate: this plate hangs off a figure that is TURNED to face
         the lever, so without it the card sits edge-on and reads as a line.
         The other plates in this deck hang off risers, which are never
         rotated, which is why only this one needed it. */
      cp.rotation.y = 1.35;
      caller.g.add(cp);

      lossBolt = glowSprite(LOSS, 3.4, 0);
      lossBolt.position.set(BASIN_X, 1.0, 1.2);
      root.add(lossBolt);

      /* The people whose money this is. The waterfall is an argument about
         who takes a loss and in what order, and it lands harder with the
         two of them standing at the tanks it happens in. The junior funder
         is the one who moves when it goes wrong — that is the whole point
         of the tranche, and it is true, so it can be shown. */
      /* Placed BEHIND the plane of the things the camera pushes in on. Every
         shot in this scene is a push or a crane toward the rig or the slab,
         so anything standing on the camera side of either ends up filling a
         third of the frame at exactly the beat that must be read. */
      supplier = makeFigure(root, "supplier");
      supplier.g.position.set(-7.4, 0, -0.9);
      supplier.face(1.25);

      /* Both funders to the RIGHT of the rig, same reason as S4: the slab
         and the supplier own the left of this stage, and a figure parked
         over there covers the invoice in every shot that pushes on it. */
      /* Risers. Each figure stands on its own platform and the platform is
         what moves; the floor now writes depth, so "down" genuinely hides
         them instead of sinking them through a see-through stage. */
      /* Clear of the rig's own tranche plates, which hang off its right
         side at head height. At +3.5 the SENIOR FUNDER card landed exactly
         on the SENIOR tranche card and each ate the other's first line. */
      seniorRise = riser(root, BASIN_X + 4.1, 0.6);
      seniorFunder = makeFigure(seniorRise, "funder", { accent: SUCCESS });
      seniorFunder.face(-1.0);

      juniorRise = riser(root, BASIN_X + 5.8, 2.1);
      juniorFunder = makeFigure(juniorRise, "funder", { accent: ACCENT });
      juniorFunder.face(-1.0);

      const sb = board(620, 160, (c) => {
        c.clearRect(0, 0, 620, 160);
        cardHead(c, 4, 46, "SENIOR FUNDER", SUCCESS, 25);
        cardHead(c, 4, 100, "ALLOWLISTED", PAPER, 21);
      });
      seniorBoard = sb;
      const sp = boardPlane(sb, 2.0, 2.0 * 160 / 620, { renderOrder: 5 });
      sp.position.set(0, 3.30, 0.1);
      seniorRise.add(sp);

      const jb = board(620, 160, (c) => {
        c.clearRect(0, 0, 620, 160);
        cardHead(c, 4, 46, "JUNIOR FUNDER", ACCENT, 25);
        cardHead(c, 4, 100, "FIRST LOSS", PAPER, 21);
      });
      const jp = boardPlane(jb, 2.0, 2.0 * 160 / 620, { renderOrder: 5 });
      jp.position.set(0, 3.30, 0.1);
      juniorRise.add(jp);


      /* THE BUYER. The party who owes the money and the party this whole
         product refuses to name. They pay in the settle half and they do not
         in the default half — that is the only difference between the two,
         and it is the difference the scene exists to show. */
      buyerRise = riser(root, BUYER_X, 0.4);
      buyer = makeFigure(buyerRise, "buyer");
      buyer.face(-1.25);

      const bb = board(620, 150, (c) => {
        c.clearRect(0, 0, 620, 150);
        cardHead(c, 4, 44, "THE BUYER", PAPER, 27);
        cardHead(c, 4, 96, "COMMITMENT 0XA41D…77E3", ACCENT, 17);
        cardHead(c, 4, 136, "NEVER NAMED ON CHAIN", WARNING, 15);
      });
      buyerPlate = boardPlane(bb, 2.1, 2.1 * 150 / 620, { renderOrder: 5 });
      buyerPlate.position.set(0, 2.62, 0.02);
      buyerRise.add(buyerPlate);
    },

    update(t) {
      env.update(t);
      invoice.update(t);

      /* ── the figures ───────────────────────────────────────────────
         Movement is rationed. CRAFT.md: if two things move at once the eye
         picks neither, and in this scene the thing that must be watched is
         a fill level. So the figures walk only in the gaps between beats,
         and hold still through every landing. */
      const supWalk = seg(t, 1.0, 3.4) - seg(t, 9.0, 11.0);
      supplier.g.position.x = -7.4 + 1.6 * supWalk;
      supplier.update(t, (t > 1.0 && t < 3.4) || (t > 9.0 && t < 11.0) ? 1 : 0);

      /* Risers. Up is 0, down is out of sight below the stage. */
      /* Deeper than the tallest thing standing on a riser, which is a
         FUNDER PLATE at y 3.30 with a half-height of 0.26 — so its top rides
         at 3.56, and at DOWN -2.9 it stopped 0.66 above the stage floor.
         The figure was gone and its heading was still sitting there, which
         is worse than not lowering it at all. -4.2 clears the plate with
         room, and nothing on a riser reaches that high. */
      const DOWN = -4.2;
      const buyerUp = 1
        - eInOut(seg(t, S.buyerDown0, S.buyerDown1))
        + eInOut(seg(t, S.buyerUp0, S.buyerUp1));
      const funderUp = eInOut(seg(t, S.fundersUp0, S.fundersUp1))
        - eInOut(seg(t, S.fundersDown0, S.fundersDown1));
      buyerRise.position.y = lerp(DOWN, 0, buyerUp);
      seniorRise.position.y = lerp(DOWN, 0, funderUp);
      juniorRise.position.y = lerp(DOWN, 0, funderUp);

      seniorFunder.update(t, 0);

      /* The junior funder steps BACK as the junior tranche drains. Not a
         flourish — first loss is theirs, and this is the one figure beat in
         the deck that carries information. */
      const retreat = eInOut(seg(t, S.lossEnter, S.juniorEmpty + 0.6));
      const rejoin = eInOut(seg(t, LOOP - 2.4, LOOP));
      const back = t >= S.cut ? retreat * (1 - rejoin) : 0;
      // The riser carries them back, so the figure stays centred on it.
      juniorRise.position.x = BASIN_X + 5.8 + 1.4 * back;
      juniorRise.position.z = 2.1 + 0.6 * back;
      /* The one figure beat in the deck that carries information gets the
         one expression change that does too. */
      juniorFunder.express(t >= S.cut && t >= S.lossEnter ? "down" : "neutral");
      seniorFunder.express(t >= S.cut ? "neutral" : t >= S.yield ? "pleased" : "neutral");
      supplier.express(t < S.cut && t >= S.stamped ? "pleased" : "neutral");
      juniorFunder.update(t, (t > S.lossEnter && t < S.juniorEmpty + 0.6) || (t > LOOP - 2.4) ? 1 : 0);

      /* The buyer leans in as they hand the payment over, and stands
         perfectly still through the default half. Nothing leaves them there,
         and that stillness IS the default — no absconding, no drama, just a
         payment that does not come. */
      buyer.update(t, t > S.payFly - 0.6 && t < S.payLand ? 1 : 0);

      const settling = t < S.cut;

      /* ── SETTLE ───────────────────────────────────────────────────── */
      if (settling) {
        caller.g.visible = false;
        if (armed) {
          armed = false;
          leverBoard.redraw((c) => {
            c.clearRect(0, 0, 660, 190);
            cardHead(c, 4, 46, "MARKDEFAULT()", PAPER, 25);
            cardHead(c, 4, 98, "LOCKED", LOSS, 27);
            cardHead(c, 4, 148, "UNTIL DUE + GRACE", PAPER, 16);
          });
        }
        leverArm.rotation.x = 0;
        (leverArm.material as THREE.MeshToonMaterial).color.setHex(LOSS);
        invoice.setState(t >= S.stamped ? "settled" : "funded");
        basins.setWiped("junior", false);
        graceRig.visible = false;
        lever.visible = false;
        lossBolt.material.opacity = 0;

        // the repayment flies in on an ARC, not a lerp
        const flying = t >= S.payFly && t < S.payLand + 0.6;
        payment.visible = flying;
        if (flying) {
          const p = eInOut(seg(t, S.payFly, S.payLand));
          const [x, y, z] = arc(
            PAY_FROM.x, PAY_FROM.y, PAY_FROM.z,
            PAY_TO.x, PAY_TO.y, PAY_TO.z, p, 1.5,
          );
          payment.position.set(x, y, z);
          payment.rotation.z = lerp(-0.5, 0.06, eOutBack(p));
          // squash on arrival, volume preserved
          const sy = impactY(t - S.payLand, 0.35, 0.05, 0.14);
          payment.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
        }

        /* THE DE-LISTING, then the exit. The plate flips to DE-LISTED and
           the redemption goes through anyway — that is the whole claim, and
           it is only a claim worth making because the contract genuinely
           does not gate `_withdraw`. */
        const nowDelisted = t >= S.delist;
        if (nowDelisted !== delisted) {
          delisted = nowDelisted;
          seniorBoard.redraw((c) => {
            c.clearRect(0, 0, 620, 160);
            cardHead(c, 4, 46, "SENIOR FUNDER", SUCCESS, 25);
            cardHead(c, 4, 100, delisted ? "DE-LISTED" : "ALLOWLISTED",
              delisted ? WARNING : PAPER, 21);
          });
        }

        const redeeming = t >= S.redeemOut;
        redeem.visible = redeeming;
        if (redeeming) {
          const p = eOutCubic(seg(t, S.redeemOut, S.redeemIn));
          const [x, y, z] = arc(BASIN_X - 0.9, 3.40, 0.55, BASIN_X + 4.1, 0.10, 1.5, p, 1.3);
          const sy = impactY(t - S.redeemIn, 0.28, 0.05, 0.13);
          redeem.position.set(x, y, z);
          redeem.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
          redeem.rotation.y = lerp(0.5, -0.2, eOutBack(p));
        }

        // Levels move ONLY at the beats that move money. No tween runs ahead
        // of the event that confirms it — §7 rule 3.
        let lvl = L0;
        if (t >= S.yield) lvl = L_YIELD;
        else if (t >= S.principal) lvl = L_PRINCIPAL;
        // The rise itself is eased, but it starts AT the beat, never before.
        const from = t >= S.yield ? L_PRINCIPAL : L0;
        const at = t >= S.yield ? S.yield : S.principal;
        const eased = t >= S.principal
          ? lerp(from, lvl, eOutCubic(seg(t, at, at + 0.55)))
          : L0;
        // Identical for both through the split — two fills, same size,
        // landing together. They diverge only at the exit, because
        // redeeming one ERC-4626 share class does not touch the other.
        const exit = t >= S.redeemIn
          ? eInOut(seg(t, S.redeemIn, S.redeemIn + 0.55)) : 0;
        basins.setLevel("senior", lerp(eased, 0.30, exit));
        basins.setLevel("junior", eased);
        return;
      }

      /* ── DEFAULT ──────────────────────────────────────────────────── */
      payment.visible = false;
      redeem.visible = false;
      caller.g.visible = false;
      if (delisted) {
        delisted = false;
        seniorBoard.redraw((c) => {
          c.clearRect(0, 0, 620, 160);
          cardHead(c, 4, 46, "SENIOR FUNDER", SUCCESS, 25);
          cardHead(c, 4, 100, "ALLOWLISTED", PAPER, 21);
        });
      }
      invoice.setState(t >= S.lossEnter ? "defaulted" : "funded");
      /* Both are struck on the cut to the crane. Their beat is over by then,
         and the payoff frame is the two tanks and nothing else — a spent
         countdown and a pulled lever standing in it are two props arguing
         for attention against the one comparison the scene exists to make. */
      const instruments = t < S.craneUp;
      graceRig.visible = instruments;
      lever.visible = instruments;

      /* ── who calls it ──────────────────────────────────────────────
         The caller walks up while the grace period is still running and
         WAITS. The lever is locked until it expires, because calling early
         reverts — the wait is the accurate part. */
      const walk = eInOut(seg(t, S.callerIn, S.callerAt));
      /* They leave the way they came — LEFT, and out of frame before the
         crane. Walking them to the right sent them straight through the
         middle of the payoff shot, standing in front of the empty tank the
         whole scene exists to show. */
      /* They go as soon as the lever is pulled. Their beat ends there, and
         B2 frames the tanks from stage right, which puts anyone still
         standing at the lever half outside the left edge of it. */
      const leave = eInOut(seg(t, S.lossEnter + 0.5, S.lossEnter + 2.7));
      caller.g.visible = t >= S.callerIn - 0.6 && t < S.lossEnter + 2.9;
      /* They walk at roughly the lever's own depth. Downstage of it they
         were half a frame tall and clipped by the bottom edge — a passer-by
         with no stake in the invoice should not be the biggest thing on
         stage. */
      caller.g.position.x = lerp(1.9, -0.15, walk) - 7.4 * leave;
      caller.g.position.z = 2.7;
      caller.update(t,
        (t > S.callerIn && t < S.callerAt)
          || (t > S.craneUp - 2.0 && t < S.craneUp + 0.3) ? 1 : 0);

      const nowArmed = t >= S.graceEnd;
      if (nowArmed !== armed) {
        armed = nowArmed;
        leverBoard.redraw((c) => {
          c.clearRect(0, 0, 660, 190);
          cardHead(c, 4, 46, "MARKDEFAULT()", PAPER, 25);
          cardHead(c, 4, 98, armed ? "CALLABLE" : "LOCKED", armed ? SUCCESS : LOSS, 27);
          cardHead(c, 4, 148, armed ? "BY ANYONE AT ALL" : "UNTIL DUE + GRACE", PAPER, 16);
        });
      }
      // The pull happens ON the frame the loss enters — the lever IS the
      // cause, not a decoration beside it.
      const pull = eOutBack(seg(t, S.lossEnter - 0.35, S.lossEnter + 0.15));
      leverArm.rotation.x = pull * 1.15;
      (leverArm.material as THREE.MeshToonMaterial).color.setHex(armed ? SUCCESS : LOSS);

      // the grace bar depletes left to right
      const gp = seg(t, S.graceStart, S.graceEnd);
      graceFill.scale.x = Math.max(1 - gp, 0.0001);
      graceMat.color.setHex(gp >= 1 ? LOSS : WARNING);

      // Senior does not move. Not one pixel. §7 rule 5.
      basins.setLevel("senior", L0);

      if (t >= S.lossEnter) {
        const d = seg(t, S.lossEnter, S.juniorEmpty);
        // eInCubic: the drain accelerates. A linear drain reads as a slider.
        basins.setLevel("junior", lerp(L0, JUNIOR_AFTER, eInCubic(d)));
        basins.setWiped("junior", true);
        lossBolt.material.opacity = 0.55 * (1 - eOutCubic(seg(t, S.lossEnter, S.lossEnter + 1.2)));
      } else {
        basins.setLevel("junior", L0);
        basins.setWiped("junior", false);
        lossBolt.material.opacity = 0;
      }
    },

    camera(t): Shot {
      /* Shot table. Hard cuts between shots; movement lives INSIDE a shot.
         The last shot's end must equal the first shot's start — the loop is
         verified by seeking past LOOP and comparing, not by assertion. */

      /* A1 — wide, the book and the invoice together, HELD through the
         payment landing, the funders rising and the yield split (0 -> 6.0).
         It used to cut at 4.2, one tenth of a second before the funders came
         up, so the shot that introduced them was already the tight one and
         both of them stood half outside it. Cut after a beat resolves, not
         into the middle of one. */
      if (t < 6.0) {
        const p = seg(t, 0, 6.0);
        return {
          pos: [lerp(-0.4, 1.2, p), 4.5, lerp(15.2, 14.0, p)],
          look: [lerp(0.3, 1.6, p), 2.0, 0],
          fov: 44,
        };
      }
      /* A2 — the two credited tranches WITH the two funders they belong to
         (6.0 -> 8.6). Framed to hold the whole rig and both figures: the
         previous framing held the rig alone and clipped the funders in half
         at the right edge, which turned the shot that pays them into a shot
         about a tank. */
      if (t < 8.6) {
        const p = seg(t, 6.0, 8.6);
        return {
          pos: [lerp(4.2, 4.4, p), lerp(4.1, 3.8, p), lerp(14.6, 13.4, p)],
          look: [lerp(4.6, 4.8, p), lerp(2.15, 2.00, p), 0.8],
          fov: 36,
        };
      }
      // A3 — the settled slab (8.6 -> 10.6)
      if (t < 10.6) {
        const p = seg(t, 8.6, 10.6);
        return {
          pos: [lerp(-3.4, -3.0, p), 2.6, lerp(6.4, 5.9, p)],
          look: [-4.5, 1.35, 1.0],
          fov: 34,
        };
      }
      // ── CUT ── A4 — the exit. The de-listed funder and the tank they draw
      // from, in one frame, so the plate and the stack are read together.
      if (t < S.cut) {
        const p = eInOut(seg(t, 10.6, S.cut));
        return {
          /* Re-framed when the funders moved out from under the rig's own
             plates: at the old distance the redeemed stack sat on the beat
             line and the junior funder was cut in half by the right edge. */
          pos: [lerp(4.6, 4.8, p), lerp(4.2, 3.9, p), lerp(13.6, 12.6, p)],
          look: [lerp(4.9, 5.2, p), lerp(2.10, 1.95, p), 0.9],
          fov: 36,
        };
      }
      // ── HARD CUT ──
      // B1 — telephoto on the grace bar (15.0 -> 21.4)
      if (t < S.lossEnter) {
        /* Wide enough to hold the grace bar, the lever and whoever is
           standing at it. The beat is a causal chain — the period runs out,
           the lever unlocks, someone pulls it — and a chain needs all its
           links in the same frame. */
        const p = eInOut(seg(t, S.cut, S.lossEnter));
        return {
          pos: [lerp(-2.9, -2.4, p), lerp(3.9, 3.6, p), lerp(12.6, 11.6, p)],
          look: [lerp(-2.8, -2.3, p), 1.95, 1.8],
          fov: 34,
        };
      }
      // B2 — cut ON the loss entering junior (21.4 -> 25.0)
      if (t < S.craneUp) {
        const p = seg(t, S.lossEnter, S.craneUp);
        /* Back far enough that the EMPTY tank still reads as a tank, and
           the senior fill stays in frame above it. Sitting closer put the
           lens inside the rig: the beat is a comparison, and a comparison
           needs both halves. */
        return {
          pos: [lerp(2.3, 2.1, p), lerp(2.3, 2.1, p), lerp(9.4, 8.8, p)],
          look: [BASIN_X, lerp(1.45, 1.30, p), 0],
          fov: 34,
        };
      }
      // B3 — CRANE UP. Both basins in one frame: empty and full. The payoff.
      const p = seg(t, S.craneUp, S.resolve);
      const e = eInOut(p);
      /* The crane STARTS at a distance the rig fits in. At 6.9 units the
         lens was inside it: the empty junior tank filled the frame and the
         senior fill — the other half of the comparison — was above the top
         edge for the first third of the move. */
      return {
        pos: [lerp(1.9, 0.5, e), lerp(1.7, 4.5, e), lerp(10.6, 14.2, e)],
        look: [lerp(BASIN_X, 0.3, e), lerp(1.35, 2.0, e), 0],
        fov: lerp(40, 44, e),
      };
    },

    caption(t): Caption {
      if (t < 4.2) return {
        title: "The buyer repays.",
        sub: "On chain, in the book's own token. The contract observes it directly.",
        beat: "No oracle, no proof, no reserve — the settlement is the transaction.",
      };
      if (t < 8.6) return {
        title: "The yield splits.",
        sub: "Fifty-fifty across the two tranches, at the moment the repayment lands.",
        beat: "Two fills, the same size, on the same frame. That is the split.",
      };
      if (t < 10.6) return {
        title: "Settled.",
        sub: "The invoice is closed and the capital is back in the pool.",
        beat: "Register, score, attest, fund, settle — the whole loop, on chain.",
      };
      if (t < S.redeemIn) return {
        title: "And this funder has been de-listed.",
        sub: "Removed from the allowlist that gates who may deposit and who may hold shares.",
        beat: "Deposits are gated. Transfers are gated. Withdrawal is deliberately not.",
      };
      if (t < S.cut) return {
        title: "They exit in full.",
        sub: "Four blocks back against the three that went in — the same shares, now worth more of the asset.",
        beat: "A compliance control that traps capital is a worse problem than the one it solves.",
      };
      if (t < S.lossEnter) return {
        title: "And when the buyer does not pay.",
        sub: "Default is the due date plus a fourteen-day grace period, and nothing more.",
        beat: "block.timestamp past due plus grace — and anyone at all may call it.",
      };
      if (t < S.craneUp) return {
        title: "Junior absorbs it.",
        sub: "The first-loss tranche takes the whole write-down, in order, down to what little is left.",
        beat: "Junior takes all of it. Senior takes none of it.",
      };
      return {
        title: "Senior is untouched.",
        sub: "Not reduced, not dented — untouched. This is what subordination buys.",
        beat: "That is the ledger, not a slide.",
      };
    },
  };
}
