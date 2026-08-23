/* S4 · THE VAULT — PLAN.md §5.
   ─────────────────────────────────────────────────────────────────────────
   Line: two tranches over one pool.

   Capital leaves the pool and reaches the supplier as face value MINUS the
   graded discount, and the discount is a gap you can see — the advance
   block is visibly shorter than the invoice's face. That gap is the entire
   commercial mechanism and it does not need a number on it.

   The two books stand side by side and NEVER touch. An invoice is faced,
   funded and repaid in one of them; the protocol never converts. That is
   the FX-risk argument, and here it is a geometry argument rather than a
   sentence: there is no pipe between the two rigs, and the camera holds
   both in one frame long enough for you to look for one.

   §7 rule 3: the junior and senior levels drop on the frame the advance
   LEAVES the pool, and the slab lifts to `funded` on the frame it ARRIVES.
   Neither runs ahead of the other, and nothing tweens toward a level before
   the movement that caused it.

   Loop 24s. */

import * as THREE from "three";
import type { Scene3D, Shot, Caption } from "../engine";
import { gridFloor, obox } from "../voxel";
import { board, boardPlane, cardHead, figureText } from "../board";
import { css, INK, PAPER, ACCENT, ACCENT_DEEP, ACCENT_LIGHT, SUCCESS, WARNING, LOSS, STEEL } from "../palette";
import { makeEnvironment, type EnvHandle } from "../env";
import { makeBasins, type BasinsHandle } from "../cast/basins";
import { makeInvoice, type InvoiceHandle } from "../cast/invoice";
import { makeFigure, type FigureHandle } from "../cast/figure";
import { addr, shortAddr, navPriceUsd } from "../deck-data";
import { makeHelper, type HelperHandle } from "../cast/helper";
import { seg, eInOut, eOutBack, lerp, arc, impactY } from "../craft";

const LOOP = 32;

const S = {
  /* THE GATE. A third funder walks up and is turned away, is allowlisted,
     and then deposits. `CifraTrancheVault.canHold` gates deposits and
     `_update` gates transfers when a CifraFunderRegistry is set — tranche
     shares are plausibly securities and a permissionless ERC-4626 cannot
     express "professional investors only". */
  gateTry: 1.8, gateBounce: 2.6,   // deposit attempted, and reverted
  gateList: 4.4,                    // allowlisted
  deposit: 7.6, depositIn: 8.8,     // capital goes IN — levels rise HERE
  advanceOut: 11.8,     // capital leaves the pool — levels drop HERE
  advanceIn: 13.6,      // it reaches the supplier — the slab lifts HERE
  compare: 16.6,        // the face/advance gap is held
  books: 20.6,          // pull back to both books
  reset: 27.0,
};

const START = 0.58;         // before the funders deposit
const FULL = 0.86;          // after the deposit, before the advance
const DEPLOYED = 0.62;      // after the advance goes out


/* STAGE LAYOUT
   ─────────────────────────────────────────────────────────────────────────
   Upstage, one row at z 0: the BOT book, the native deposit helper, the USDT
   book. The two books are spread far enough apart for the helper to sit
   INLINE between them rather than off to one side, so the row reads as one
   piece of infrastructure.

   Midstage, a shallow curved row at z ~3.5: the funders, facing the helper.
   An arc rather than a line, so three figures at three depths never stack
   into one silhouette and the middle of the row does not hide the helper.

   Downstage, z 6.4: the allowlist gate, its arm PARALLEL to the books. It is
   the first thing in the scene and the last thing between an unknown address
   and the rest of the stage, and standing it across the front is what makes
   it read as a way in rather than as scenery. */
const BOT_X = -5.6;
const HELPER_X = 0.0;
const HELPER_Z = 0.4;
const USDT_X = 5.6;
const SUP_X = -15.0;
/* Downstage-LEFT, not downstage-centre. Standing it in the middle of the
   front put the raised arm straight through the row shot behind it — a set
   piece whose beat is over should not go on occluding the ones that follow. */
const GATE_X = -11.2;
const GATE_Z = 8.6;
/** Where the unknown address starts, and where it walks to at the gate. */
const GATE_FROM: [x: number, z: number] = [-16.4, 13.8];
/** Where they wait: square in front of the OPENING, not beside a post. */
const GATE_WAIT: [x: number, z: number] = [-11.2, 12.2];
/** And the point they pass through once the arm lifts — dead centre of the
 *  gap, upstage of the arm. Walking to the row directly cut the corner and
 *  took them straight through the left-hand post. */
const GATE_THRU: [x: number, z: number] = [-11.2, 7.2];
/** The funders' arc, left to right, facing the helper.
 *  ROW[0] is the NEAR end — the mark closest to the gate, and the one the
 *  approved address takes. Sending them to the far end meant a new arrival
 *  crossing the entire stage in front of the two funders already standing
 *  there, for no reason other than that the slot was free. */
const ROW: [x: number, z: number, ry: number][] = [
  [-5.0, 4.6, 2.27],
  [-1.8, 4.1, 2.69],
  [1.4, 4.6, -2.82],
];
/** Which mark each funder stands on. */
const GATE_AT = 0, SENIOR_AT = 1, JUNIOR_AT = 2;

/** Who puts capital in: the two standing funders, and the one just let in. */
const DEPOSITORS = ["senior", "junior", "gate"] as const;
type Dep = (typeof DEPOSITORS)[number];

export function s4Vault(): Scene3D {
  let env: EnvHandle;
  let bot: BasinsHandle;
  let usdt: BasinsHandle;
  let inv: InvoiceHandle;
  let supplier: FigureHandle;
  let seniorFunder: FigureHandle;
  let juniorFunder: FigureHandle;
  let advance: THREE.Group;
  let face: THREE.Mesh;
  let helper: HelperHandle;
  let gateFunder: FigureHandle;
  let barrier: THREE.Group;
  let barrierArm: THREE.Mesh;
  let gatePlate: THREE.Mesh;
  let gateBoard: ReturnType<typeof board>;
  let gatePlateFig: THREE.Mesh;
  let listed = false;
  /* One block per funder, including the one who was just allowlisted — an
     address that gets let in and then does nothing is a gate with no point
     on the other side of it. */
  const deposits: Record<Dep, THREE.Group | null> = { senior: null, junior: null, gate: null };

  return {
    loop: LOOP,

    build(root) {
      env = makeEnvironment(root, { kind: "freight", density: 0.75, motes: 7, seed: 61, loop: LOOP });
      gridFloor(root, 70, ACCENT, 0.08);

      /* The BOT book's plates hang LEFT, the USDT book's RIGHT — outward,
         away from the middle of the stage, because the middle of the stage
         is where the funders stand. */
      bot = makeBasins(root, { book: "BOT", plateSide: -1, controller: shortAddr(addr.botController).toUpperCase() });
      bot.g.position.set(BOT_X, 0, 0);
      bot.setLevel("senior", START);
      bot.setLevel("junior", START);

      usdt = makeBasins(root, { book: "USDT", controller: shortAddr(addr.usdtController).toUpperCase() });
      usdt.g.position.set(USDT_X, 0, 0);
      // The USDT book is deployed and live, and it is NOT the book this
      // invoice is in. It simply stands there, untouched, for the whole
      // scene — which is the claim.
      usdt.setLevel("senior", 0.71);
      usdt.setLevel("junior", 0.58);

      supplier = makeFigure(root, "supplier");
      /* -- the NAV oracle, wired to nothing --------------------------------
         The scene's closing beat is "no price oracle sits anywhere money
         moves". Everything else on this stage is visibly plumbed: the helper
         sits inline in the row, the gate stands across the path. This panel
         has a post and nothing else — no pipe to either book, no line to the
         settlement. The ABSENCE of a connector is the argument, which is why
         there is deliberately no connecting geometry to draw.

         Placement took three passes, all of them the same mistake in a
         different direction: anything at tank height ends up reading as a
         readout bolted to whichever rig it lands near, which is exactly the
         wiring this panel exists to deny. At x 0 z -4.2 it sat behind the
         BOT tank; moved outboard to x -10.6 it collided with that rig's
         senior plate once the resolve widened.

         So: centred between the two books and ABOVE both of them, far
         upstage. The rigs top out near y 4.2 — at y 5.6 it clears them,
         belongs to neither, and the empty air around it is the argument.

         The post is a STUB under the panel, not a mast to the floor. A
         full-height post ran down through the helper gantry and read as
         plumbing into the one prop on this stage that genuinely is a money
         path — the opposite of the point, arrived at while trying to make
         the point. */
      const navPost = obox(root, 0.16, 0.5, 0.16, STEEL, 0, 4.95, -6.0,
        { outlineThickness: 0.055 });
      void navPost;
      const nb = board(680, 250, (c) => {
        c.clearRect(0, 0, 680, 250);
        cardHead(c, 4, 42, "NAV ORACLE · DISPLAY ONLY", WARNING, 22);
        figureText(c, 4, 116, `BOT / USD  ${navPriceUsd}`, PAPER, 46, "700");
        cardHead(c, 4, 168, "30-MIN TWAP FROM THE DEX POOL", PAPER, 17);
        cardHead(c, 4, 206, "READ BY NO CONTRACT THAT MOVES MONEY", ACCENT, 17);
        figureText(c, 676, 240, shortAddr(addr.navOracle).toUpperCase(), ACCENT_DEEP, 20, "400", "right");
      });
      const np = boardPlane(nb, 2.3, 2.3 * 250 / 680, { renderOrder: 4 });
      np.position.set(0, 5.62, -5.92);
      root.add(np);

      supplier.g.position.set(SUP_X, 0, 1.6);
      supplier.face(1.35);

      /* The funders. Capital does not appear in the tanks by itself — two
         people put it there, and they are the ones carrying the risk the
         tranches divide up.

         BOTH stand to the RIGHT of the rig. One on each side looked more
         balanced and cost the scene its subject: the supplier and the graded
         invoice live off to the left, and the left-hand funder stood square
         in front of them. Which tranche each funds is read from where their
         deposit FLIES, not from where they stand — the arc says it better
         than the position did. They are staggered in depth so they do not
         merge into one silhouette. */
      /* Tinted to the tranche each backs — the senior funder carries the
         SENIOR plate's green, the junior funder the JUNIOR plate's
         terracotta. Two identical funders on two identical spots were one
         role drawn twice. */
      seniorFunder = makeFigure(root, "funder", { accent: SUCCESS });
      seniorFunder.g.position.set(ROW[SENIOR_AT][0], 0, ROW[SENIOR_AT][1]);
      seniorFunder.face(ROW[SENIOR_AT][2]);

      juniorFunder = makeFigure(root, "funder", { accent: ACCENT });
      juniorFunder.g.position.set(ROW[JUNIOR_AT][0], 0, ROW[JUNIOR_AT][1]);
      juniorFunder.face(ROW[JUNIOR_AT][2]);

      for (const [fig, label, col, ry] of [
        [seniorFunder, "SENIOR FUNDER", SUCCESS, ROW[SENIOR_AT][2]],
        [juniorFunder, "JUNIOR FUNDER", ACCENT, ROW[JUNIOR_AT][2]],
      ] as [FigureHandle, string, number, number][]) {
        const lb = board(520, 90, (c) => {
          c.clearRect(0, 0, 520, 90);
          cardHead(c, 4, 58, label, col, 26);
        });
        const lp = boardPlane(lb, 1.7, 1.7 * 90 / 520, { renderOrder: 5 });
        /* On the figure's BACK, turned round. They stand facing the rig, so
           a plate on their front faces upstage — and a single-sided plane
           facing upstage is a plate nobody in the audience can read. */
        lp.position.set(0, 2.62, -0.14);
        /* Counter-rotated out of the figure's frame so it faces the house,
           not wherever the figure happens to be turned. The row stands in an
           arc looking at the helper, so a plate fixed to the body reads at
           whatever angle its owner is standing — three cards, three degrees
           of squash, none of them square. */
        lp.rotation.y = -ry;
        fig.g.add(lp);
      }

      /* -- THE GATE -----------------------------------------------------
         A funder who is not on the list. They approach, their deposit is
         refused, they are allowlisted, and then it goes through. This is
         `CifraFunderRegistry` + `CifraTrancheVault.canHold`, and it is the
         product's answer to "tranche shares are plausibly securities" —
         which is worth a beat, because most protocols answer it by not
         answering it. */
      gateFunder = makeFigure(root, "funder", { accent: WARNING });
      gateFunder.g.position.set(GATE_FROM[0], 0, GATE_FROM[1]);
      gateFunder.face(1.05);

      /* The third funder carries their own plate too. In a row where the
         other two are named, the unnamed one reads as an extra rather than
         as the address the whole first beat was about. It only appears once
         they are on the list. */
      {
        /* An opaque CARD, not bare type — the only funder plate that is.
           This one has to sit over the BOT rig's junior fill, and green
           letters on a terracotta wash is the one combination in this
           palette that goes to mush. Given a ground and a border it reads
           against anything, which means it no longer has to be moved away
           from its owner to be legible. */
        const lb = board(520, 130, (c) => {
          c.fillStyle = css(INK);
          c.fillRect(0, 0, 520, 130);
          c.strokeStyle = css(SUCCESS);
          c.lineWidth = 5;
          c.strokeRect(2.5, 2.5, 515, 125);
          c.fillStyle = css(SUCCESS);
          c.fillRect(0, 0, 520, 9);
          cardHead(c, 20, 84, "ALLOWLISTED", SUCCESS, 30);
        });
        gatePlateFig = boardPlane(lb, 1.7, 1.7 * 130 / 520,
          { transparent: false, renderOrder: 5 });
        gatePlateFig.visible = false;
        /* Added to ROOT rather than to the figure, and driven in WORLD
           space each frame — this figure turns through ninety degrees on the
           second leg of its walk, and a parented plate would swing with it.
           Root-parented and square to camera is what "a label belongs to the
           camera, not to its owner" (PLAN.md §4.4) actually asks for. */
        root.add(gatePlateFig);
      }

      barrier = new THREE.Group();
      barrier.position.set(GATE_X, 0, GATE_Z);
      root.add(barrier);
      /* STEEL, not STEEL_DARK. Dark posts on a dark stage left the arm
         floating with nothing holding it up. */
      obox(barrier, 0.24, 1.7, 0.24, STEEL, -1.05, 0.85, 0, { outlineThickness: 0.06 });
      obox(barrier, 0.24, 1.7, 0.24, STEEL, 1.05, 0.85, 0, { outlineThickness: 0.06 });
      barrierArm = obox(barrier, 2.1, 0.24, 0.16, LOSS, 0, 1.25, 0, { outlineThickness: 0.05 });

      const gb = board(560, 160, (c) => {
        c.clearRect(0, 0, 560, 160);
        cardHead(c, 4, 44, "FUNDER REGISTRY", PAPER, 24);
        cardHead(c, 4, 96, "RESTRICTED", LOSS, 30);
      });
      gateBoard = gb;
      gatePlate = boardPlane(gb, 1.9, 1.9 * 160 / 560, { renderOrder: 5 });
      gatePlate.position.set(0, 2.14, 0.12);
      barrier.add(gatePlate);

      /* The helper sits BESIDE the deposit path, between the funders and
         the rig. Native BOT goes in one side and wrapped BOT comes out the
         other — the colour change at the pass IS the wrap, and it happens in
         one crossing because that is one call. */
      helper = makeHelper(root, HELPER_X, HELPER_Z);

      for (const which of DEPOSITORS) {
        const g = new THREE.Group();
        root.add(g);
        for (let i = 0; i < 3; i++) {
          obox(g, 0.64, 0.14, 0.44, ACCENT, 0, 0.09 + i * 0.16, 0, { outlineThickness: 0.05 });
        }
        g.visible = false;
        deposits[which] = g;
      }

      inv = makeInvoice(root, { buyer: "ACME CORP", amount: "26,480.00", hash: "0x8f2c…41ab" });
      inv.g.position.set(SUP_X + 1.1, 0, 1.9);
      inv.g.rotation.y = 0.45;
      inv.g.scale.setScalar(0.72);
      inv.setGrade("B");
      inv.setState("graded");

      /* -- the advance: a stack of the book's own token ------------------
         Sized against the face marker below it. Shorter, deliberately. */
      advance = new THREE.Group();
      root.add(advance);
      for (let i = 0; i < 4; i++) {
        obox(advance, 0.86, 0.16, 0.60, ACCENT, 0, 0.10 + i * 0.19, 0, { outlineThickness: 0.05 });
      }
      /* No label on the stack. The dashed marker already says FACE VALUE,
         the beat line already says the gap is the price, and a third piece
         of type here collided with the rig's JUNIOR plate on one side and
         the invoice slab on the other. The staging makes the point; the
         words were restating it. */
      advance.visible = false;

      /* -- the face marker: how tall the advance WOULD be at face value.
         An open outline, so it reads as an absence rather than a second
         stack of money. The gap between the two is the discount. */
      const fb = board(420, 620, (c) => {
        c.clearRect(0, 0, 420, 620);
        c.strokeStyle = css(PAPER, 0.5);
        c.setLineDash([14, 12]);
        c.lineWidth = 5;
        c.strokeRect(3, 3, 414, 614);
        c.setLineDash([]);
        cardHead(c, 16, 44, "FACE VALUE", PAPER, 20);
        figureText(c, 16, 110, "26,480.00", PAPER, 34, "700");
        cardHead(c, 16, 596, "GRADE B · 800 BPS", ACCENT, 19);
      });
      face = boardPlane(fb, 1.15, 1.7, { renderOrder: 4 });
      face.visible = false;
      root.add(face);
    },

    update(t) {
      env.update(t);
      helper.update(t);
      inv.update(t);

      /* ── the funders deposit ──────────────────────────────────────── */
      /* The block travels to the tank's RIM and vanishes on the frame the
         level rises — because it does not go on sitting inside the pool, it
         BECOMES the pool. The first pass landed it mid-tank and left it
         floating in the fill, which read as a crate someone had dropped in. */
      const depositing = t >= S.deposit && t < S.depositIn + 0.08;
      /* The newly-listed funder lands on the SENIOR rim too, half a metre
         further downstage, so two blocks arriving at one tank on the same
         frame stay two blocks. */
      const TANK: Record<Dep, [number, number, number]> = {
        senior: [BOT_X - 0.9, 3.50, 0.55],
        junior: [BOT_X + 0.9, 1.52, 0.55],
        gate: [BOT_X - 0.9, 3.50, 1.10],
      };
      const FROM: Record<Dep, [number, number, number]> = {
        senior: [ROW[SENIOR_AT][0], 1.0, ROW[SENIOR_AT][1]],
        junior: [ROW[JUNIOR_AT][0], 1.0, ROW[JUNIOR_AT][1]],
        gate: [ROW[GATE_AT][0], 1.0, ROW[GATE_AT][1]],
      };
      const via = helper.mouth(1);          // the side the capital enters
      const out = helper.mouth(-1);         // and leaves, wrapped
      for (const which of DEPOSITORS) {
        const g = deposits[which];
        if (!g) continue;
        g.visible = depositing;
        if (!depositing) continue;
        const from = FROM[which];
        /* TWO legs through one crossing: funder → helper, helper → tank.
           The block is ACCENT (native BOT) on the way in and ACCENT_LIGHT
           (wrapped) on the way out, and the swap happens at the pass. */
        const p = eInOut(seg(t, S.deposit, S.depositIn));
        const half = p < 0.5;
        const q = half ? p * 2 : (p - 0.5) * 2;
        const [x, y, z] = half
          ? arc(from[0], from[1], from[2], via.x, via.y, via.z, q, 0.9)
          : arc(out.x, out.y, out.z, ...TANK[which], q, 1.1);
        const sy = impactY(t - S.depositIn, 0.25, 0.04, 0.11);
        g.position.set(x, y, z);
        g.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
        for (const child of g.children) {
          const m = (child as THREE.Mesh).material as THREE.MeshToonMaterial;
          if (m && m.color) m.color.setHex(half ? ACCENT : ACCENT_LIGHT);
        }
      }

      /* Levels RISE the frame the deposit lands and DROP the frame the
         advance leaves. Never before either — §7 rule 3, and it is the same
         rule in both directions.

         The REDEMPTION is not here. A funder is paid out of a repayment, so
         it cannot be shown before the buyer has repaid — and the buyer
         repays in S5. It used to sit at the end of this scene behind a "one
         cycle later" card, which put the payout on screen before the
         payment that funded it. It now lives in S5's settle half. */
      const raise = t >= S.depositIn && t < S.reset
        ? eInOut(seg(t, S.depositIn, S.depositIn + 0.55)) : 0;
      const drop = t >= S.advanceOut && t < S.reset
        ? eInOut(seg(t, S.advanceOut, S.advanceOut + 0.6)) : 0;
      const lvl = lerp(lerp(START, FULL, raise), DEPLOYED, drop);
      bot.setLevel("senior", lvl);
      bot.setLevel("junior", lvl);

      /* The advance travels. Arc, not lerp. */
      const flying = t >= S.advanceOut && t < S.reset;
      advance.visible = flying;
      if (flying) {
        const p = eInOut(seg(t, S.advanceOut, S.advanceIn));
        const [x, y, z] = arc(BOT_X, 1.6, 1.2, SUP_X + 2.6, 0.05, 2.1, p, 2.1);
        const sy = impactY(t - S.advanceIn, 0.3, 0.05, 0.14);
        advance.position.set(x, y, z);
        advance.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
        advance.rotation.y = lerp(-0.5, 0.3, eOutBack(p));
      }

      // Lifts to `funded` the frame the advance lands.
      inv.setState(t >= S.advanceIn && t < S.reset ? "funded" : "graded");

      /* ── figures ─────────────────────────────────────────────────── */
      const supMove = (t > S.advanceIn - 0.6 && t < S.advanceIn + 0.8) ? 1 : 0;
      supplier.update(t, supMove);
      const fMove = (t > S.deposit - 0.7 && t < S.deposit + 0.3) ? 1 : 0;
      seniorFunder.update(t, fMove);
      juniorFunder.update(t, fMove);

      /* ── the gate ──────────────────────────────────────────────────
         Walk up · bounce · get listed · walk through. The bounce is a
         recoil, not a stop: `canHold` REVERTS the deposit, and a revert
         should read as being pushed back rather than as changing your mind. */
      const walkUp = eInOut(seg(t, 0.5, S.gateTry));
      const recoil = -0.9 * eOutBack(seg(t, S.gateTry, S.gateBounce))
        * (1 - eInOut(seg(t, S.gateList, S.gateList + 0.5)));
      /* Through the gate and round to the END of the funders' row. x and z
         run on different easings, which is what bends the path into a curve
         — walking a straight diagonal to your mark reads as a chess piece. */
      const join = seg(t, S.gateList + 0.4, S.deposit - 0.7);
      const goneBack = t >= S.reset ? eInOut(seg(t, S.reset, LOOP)) : 0;
      /* They stop DOWNSTAGE of the arm and square in front of the OPENING,
         not off to one side: the beat only reads if the thing in their way
         is between them and where they are going. */
      const bx = lerp(GATE_FROM[0], GATE_WAIT[0], walkUp) + recoil;
      const bz = lerp(GATE_FROM[1], GATE_WAIT[1], walkUp);

      /* Through the gap FIRST, then round to the near end of the row. Two
         legs walked at one speed: a single eased lerp from the waiting mark
         to the row mark cut the corner and put them through the left-hand
         post, which is the one thing a gate beat cannot afford. Interpolated
         by LENGTH along the polyline, so there is no stop at the waypoint. */
      const D1 = Math.hypot(GATE_THRU[0] - GATE_WAIT[0], GATE_THRU[1] - GATE_WAIT[1]);
      const D2 = Math.hypot(ROW[GATE_AT][0] - GATE_THRU[0], ROW[GATE_AT][1] - GATE_THRU[1]);
      const u = eInOut(join) * (D1 + D2);
      const leg2 = u > D1;
      const k = leg2 ? (u - D1) / D2 : u / D1;
      const px = leg2 ? lerp(GATE_THRU[0], ROW[GATE_AT][0], k) : lerp(GATE_WAIT[0], GATE_THRU[0], k);
      const pz = leg2 ? lerp(GATE_THRU[1], ROW[GATE_AT][1], k) : lerp(GATE_WAIT[1], GATE_THRU[1], k);
      const walking = join > 0;

      gateFunder.g.position.set(
        lerp(walking ? px : bx, GATE_FROM[0], goneBack),
        0,
        lerp(walking ? pz : bz, GATE_FROM[1], goneBack),
      );
      /* Turned along the leg they are on, so they face where they are going
         rather than pivoting on the spot at the corner. */
      gateFunder.face(walking
        ? lerp(0.0, ROW[GATE_AT][2], leg2 ? eInOut(k) : 0)
        : 1.05);
      /* Turned away, then let in. The only two expressions this beat needs. */
      gateFunder.express(t >= S.gateList ? "pleased" : t >= S.gateTry ? "worry" : "neutral");
      /* They throw on the same beat as the other two — being on the list is
         only worth a beat if you then see it used. */
      gateFunder.update(t,
        (t > 0.5 && t < S.gateTry) || (t > S.gateList + 0.4 && t < S.deposit - 0.7)
          || fMove || (t > S.reset && t < LOOP) ? 1 : 0);

      /* The arm lifts on the frame they are allowlisted and the plate swaps
         to ALLOWLISTED. A state change, not a fade — §7 rule 2 covers text
         as much as it covers figures. */
      const nowListed = t >= S.gateList && t < S.reset;
      if (nowListed !== listed) {
        listed = nowListed;
        gateBoard.redraw((c) => {
          c.clearRect(0, 0, 560, 160);
          cardHead(c, 4, 44, "FUNDER REGISTRY", PAPER, 24);
          cardHead(c, 4, 96, listed ? "ALLOWLISTED" : "RESTRICTED", listed ? SUCCESS : LOSS, 30);
        });
      }
      /* Only once they have taken their place, and only until the deposit
         beat is over.

         The late bound is the half PLAN.md §4.4 warns about and this scene
         had already been caught by twice: a prop whose beat is done must be
         struck. It ran to S.reset, so from the advance onward the word
         ALLOWLISTED hung over the BOT tanks with its owner cropped out of
         the telephoto — reading as a label ON the tranche rather than on a
         funder, in the two shots that belong to the advance and to the two
         books.

         The early bound is the other half: during the walk it sat right on
         the gate's own ALLOWLISTED plate — the same word twice, half a
         metre apart, at the one moment the gate plate is the thing to read. */
      gatePlateFig.visible = nowListed && t >= S.deposit - 0.7 && t < S.advanceOut;
      /* World-space, so the offset that clears the BOT rig stays cleared
         however the figure is turned — and this one turns through ninety
         degrees on the second leg of its walk.

         Offset LEFT, not right. The rig is BW 3.6 wide on posts, spanning
         x -7.52 to -3.68 around BOT_X; the funder's mark is x -5.0, inside
         that. A +1.9 offset looked clear on paper but the board is 1.7 wide
         and its text is left-aligned, so the word still landed on the
         junior fill. Going right far enough to clear it would have walked
         the plate into the senior funder's own label at ROW[1].

         Left of the rig is open dark floor all the way to the supplier at
         SUP_X -15, and it is the side this funder walked in from. Held
         downstage (+z) of the rig as well, so depth separates them even
         where they overlap in screen space. */
      /* Directly over their head. It used to be shunted 2.1 left and 1.3
         downstage to dodge the rig behind it — far enough that it stopped
         reading as this figure's label and started reading as a sign
         standing on the floor beside them. The card ground above is what
         bought the right to put it back where it belongs. */
      gatePlateFig.position.set(
        gateFunder.g.position.x,
        2.72,
        gateFunder.g.position.z + 0.2,
      );
      // Square to camera, like the other two end up after their counter-rotation.
      gatePlateFig.rotation.y = 0;
      const lift = eOutBack(seg(t, S.gateList, S.gateList + 0.7)) * (1 - goneBack);
      barrierArm.rotation.z = lift * 1.35;
      barrierArm.position.x = -lift * 0.95;
      (barrierArm.material as THREE.MeshToonMaterial).color.setHex(listed ? SUCCESS : LOSS);
      void gatePlate;

      // the face marker stands beside the advance during the comparison hold
      const comparing = t >= S.advanceIn + 0.4 && t < S.books;
      face.visible = comparing;
      if (comparing) {
        /* BEHIND the advance, not beside it. Two stacks side by side need
           horizontal room this stage does not have — left of the advance is
           the supplier, right of it is the vault rig, and the marker landed
           on one or the other every time. Directly behind, the stack sits
           inside the dashed outline and falls visibly short of its top: the
           empty band above the stack IS the discount, measured in place and
           taking no extra width at all. */
        face.position.set(SUP_X + 2.6, 0.95, 1.55);
        const s = eOutBack(seg(t, S.advanceIn + 0.4, S.advanceIn + 1.1));
        face.scale.setScalar(lerp(0.7, 1, s));
      }
    },

    camera(t): Shot {
      const HOME: Shot = { pos: [-17.2, 5.2, 26.4], look: [-13.4, 1.6, GATE_Z + 1.4], fov: 38 };

      /* C0 — the gate gets its OWN shot. Trying to hold it inside the
         establishing wide meant the barrier, the turned-away funder, the
         supplier and the invoice all shared the left third of the frame and
         none of them read. A beat that needs its own idea needs its own
         framing. */
      /* Held to +2.0, not +0.9: the arm lifting is only half the beat — the
         other half is the address walking THROUGH the gap it opened, and at
         +0.9 the cut landed before they had taken a step. */
      if (t < S.gateList + 2.0) {
        /* Wider and further back than the first pass. At 34deg from 13m the
           gate filled the frame and the address walking up to it entered
           from off-screen — you saw the arm, not the approach, and the
           approach is the beat. */
        const p = eInOut(seg(t, 0, S.gateList + 2.0));
        return {
          pos: [lerp(-17.2, -16.0, p), lerp(5.2, 4.8, p), lerp(26.4, 24.8, p)],
          look: [lerp(-13.4, -12.2, p), 1.6, GATE_Z + 1.4],
          fov: 38,
        };
      }
      // ── CUT ── C1 — crane down the BOT rig. Establishes the stack before
      // anything moves through it.
      /* ── CUT ── C1 — zoom in on the row. The funders, the helper they
         deposit through and the BOT rig behind it, in one frame, so the
         path the capital takes is a straight read across the shot. */
      if (t < S.advanceOut) {
        const p = eInOut(seg(t, S.gateList + 2.0, S.advanceOut));
        return {
          /* Held high enough that the funders' heads sit BELOW the tank
             fills rather than across them. Three figures at head height in
             front of two fill levels is four horizontal bands fighting for
             the same part of the frame. */
          pos: [lerp(-0.6, -1.2, p), lerp(7.4, 6.9, p), lerp(19.6, 17.2, p)],
          look: [lerp(-0.4, -1.4, p), lerp(2.4, 1.95, p), lerp(2.4, 1.6, p)],
          fov: 42,
        };
      }
      // ── CUT ── C2 — the advance leaving the pool and crossing.
      if (t < S.books) {
        const p = eInOut(seg(t, S.advanceOut, S.books));
        return {
          pos: [lerp(-6.4, -9.6, p), lerp(3.2, 2.6, p), lerp(10.0, 8.4, p)],
          look: [lerp(BOT_X - 0.8, SUP_X + 2.2, p), lerp(1.7, 1.15, p), 1.4],
          fov: 32,
        };
      }
      /* ── CUT ── C3 — both books in one frame. Wide, and HELD: the point is
         that you can look for a connection between them and not find one,
         which takes a moment of looking.

         The move back to HOME is the loop closing — HOME is C0's gate
         framing, and the last frame has to equal the first (§8). Running
         that as one eleven-second drift from S.books meant the shot spent
         its entire back half sliding away from the two books it had just
         asked you to compare: by t 29 the USDT rig was cut in half at the
         frame edge and the left two-thirds of frame was empty floor, under
         the line "two books, they never touch".

         So: hold the wide until RETURN, then close the loop over the last
         six seconds. Same start, same end, same loop — the difference is
         where the time is spent. */
      const RETURN = S.books + 5.4;
      const e = eInOut(seg(t, RETURN, LOOP));
      return {
        pos: [lerp(0.1, HOME.pos[0], e), lerp(5.7, HOME.pos[1], e), lerp(17.4, HOME.pos[2], e)],
        look: [lerp(0, HOME.look[0], e), lerp(2.3, HOME.look[1], e), lerp(0.6, GATE_Z, e)],
        fov: lerp(50, HOME.fov, e),
      };
    },

    caption(t): Caption {
      /* MODAL, not present tense. `fundersRestricted` is FALSE on mainnet
         677 — the vaults ship permissionless and turning the registry on is
         one governance call. "Not everyone can deposit" was true of the
         mechanism and false of the deployment, which is the exact shape of
         claim §7 exists to stop. The beat line now says which is which. */
      if (t < S.gateList) return {
        title: "Deposits can be restricted.",
        sub: "Tranche shares are plausibly securities, so the vaults can gate who deposits and who holds shares.",
        /* S5's de-listing beat is "Deposits are gated. Transfers are gated. Withdrawal is
           deliberately not." — this said almost exactly that, 43 seconds earlier, which spent
           the line twice and blunted the one that is a payoff. This one now lands what S4
           actually shows: the gate turning an address away. */
        beat: "An address that is not on the list is refused by the contract, not by the interface.",
      };
      if (t < S.depositIn) return {
        title: "Funders provide the capital.",
        sub: "One pool, two share classes. Senior is protected; junior takes first loss for more upside.",
        beat: "Allowlisted, and now they can. Both tranches are ERC-4626 vaults — deposit, hold shares, redeem.",
      };
      if (t < S.advanceOut) return {
        title: "Native BOT goes in directly.",
        sub: "The book is denominated in wrapped BOT, so a helper wraps and deposits in a single call.",
        beat: "It is stateless, holds nothing, and is privileged nowhere — anyone may wrap by hand instead.",
      };
      if (t < S.compare) return {
        title: "The supplier is paid now.",
        sub: "Face value minus the graded discount, advanced the moment the invoice is funded.",
        beat: "Forty-five days of waiting, collapsed into one transaction.",
      };
      if (t < S.books) return {
        title: "The gap is the price.",
        sub: "Grade B carries an 800 basis point discount — the base rate plus the grade's own spread.",
        beat: "That gap is what the funders earn, and the grade is what sets it.",
      };
      return {
        title: "Two books. They never touch.",
        sub: "An invoice is faced, funded and repaid in one token. The protocol never converts between them.",
        beat: "Which keeps currency risk out of the loan book — and is why no price oracle sits anywhere money moves.",
      };
    },
  };
}
