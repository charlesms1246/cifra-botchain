/* The supplier and the factor — PLAN.md §4.4.
   ─────────────────────────────────────────────────────────────────────────
   Blocky, and — since the eyes went in — capable of exactly five
   expressions and nothing else. Talos's bot silhouette (workshop/bot.tsx:
   150-235: feet, waist, chest, shoulders, neck, head) is the proportion
   reference; the visor and the antenna bulb are stripped, because those are
   what make it read as a robot with opinions.

   ON THE EYES. This file used to say "no faces — a figure with eyes steals
   every frame it stands in", and that risk is real, so the eyes are built
   against it: two small ink blocks and a brow, no whites, no mouth, no
   pupils that track anything. Expression is a STATE, set by the scene on a
   beat, exactly like the invoice's grade tab or the gate's plate — it does
   not drift, idle, or emote through a landing. A figure changing face while
   a fill level moves would be two things moving at once, which CRAFT.md
   forbids for the same reason everywhere else.

   THE BUYER HAS NO EYES, and now that everyone else does, that is louder
   than it was. See the note below: the band across their head is where the
   face would be.

   The four must be tellable apart in OUTLINE, like everything else in this
   cast — a wide brim and a tall crest are opposite silhouettes, which is the
   point of choosing them:
     supplier  shorter, narrower shoulders, a satchel on one hip
     factor    taller, broad, a wide flat brim — reads as an institution
     funder    mid height, a tall narrow crest, carrying a stack of capital
     buyer     dark, unadorned, a commitment band where a face would be
     passerby  plain — carries nothing, wears nothing, has no stake

   THE BUYER IS DELIBERATELY UNIDENTIFIED, and that is a product fact rather
   than a style choice. `CifraSettlement.payInvoice` pulls from `msg.sender`,
   so the buyer's ADDRESS is public — they sent the transaction. Their
   identity is not: the registry stores a `buyerCommitment` hash and never a
   name. So the figure is present, acts, and is on chain, while carrying a
   commitment where a nameplate would go. Anything more specific — a logo, a
   name, a country — would contradict S1 and S2 in the same frame. */

import * as THREE from "three";
import { obox, softShadow } from "../voxel";
import { INK, PAPER, ACCENT, ACCENT_DEEP, SUCCESS, STEEL, STEEL_DARK, STEEL_LIGHT } from "../palette";

export type FigureKind = "supplier" | "factor" | "funder" | "buyer" | "passerby";

/** The whole emotional range. Deliberately five, and deliberately coarse:
 *  these read at 1080p from ten metres, or they are decoration. */
export type Expression = "neutral" | "alert" | "worry" | "pleased" | "down";

const FACES: Record<Expression, [number, number, number]> = {
  neutral: [0.000, 0.00, 1.00],
  alert: [0.055, 0.00, 1.18],
  worry: [-0.020, 0.42, 0.92],
  pleased: [0.028, 0.06, 0.42],   // a blocky face smiles by squinting
  down: [-0.050, 0.34, 0.55],
};

export interface FigureOpts {
  /** Override the figure's accent. Used to tint a funder to the tranche
   *  they back: the senior funder carries the SENIOR plate's green, the
   *  junior funder the JUNIOR plate's terracotta. Two identical funders
   *  standing on two identical risers are not two roles, they are one role
   *  drawn twice — and this deck's whole discipline is that a state must be
   *  readable from the frame. */
  accent?: number;
}

export interface FigureHandle {
  g: THREE.Group;
  kind: FigureKind;
  /** Height, so scenes can place things at chest or head level. */
  height: number;
  /** Face a direction in radians. */
  face(ry: number): void;
  /** Set the expression. A discrete state, not a tween — see the header.
   *  A no-op on the buyer, who has no face to set. */
  express(e: Expression): void;
  /** `moving` 0..1 blends an idle bob into a walking step, with a forward
   *  lean and a little sway. Scenes drive it from their own schedule, so it
   *  stays a pure function of t like everything else. */
  update(t: number, moving?: number): void;
}

interface Spec {
  body: number;
  bodyDark: number;
  head: number;
  accent: number;
  scale: number;
  broad: number;
  brim: boolean;
  satchel: boolean;
  crest: boolean;
  carry: boolean;
  /** A band across the head where a face would be, and no chest mark. */
  sealed: boolean;
}

const SPECS: Record<FigureKind, Spec> = {
  supplier: {
    body: PAPER, bodyDark: STEEL, head: PAPER, accent: ACCENT,
    scale: 1.0, broad: 1.0, brim: false, satchel: true, crest: false, carry: false, sealed: false,
  },
  factor: {
    body: STEEL, bodyDark: STEEL_DARK, head: STEEL_LIGHT, accent: ACCENT_DEEP,
    scale: 1.14, broad: 1.22, brim: true, satchel: false, crest: false, carry: false, sealed: false,
  },
  funder: {
    body: STEEL_LIGHT, bodyDark: STEEL_DARK, head: PAPER, accent: SUCCESS,
    scale: 1.05, broad: 1.08, brim: false, satchel: false, crest: true, carry: true, sealed: false,
  },
  /* Unadorned, and a step darker than everyone else — but still legible.
     A first pass at STEEL_DARK/INK vanished into the background, and a
     figure you cannot see does not communicate anonymity, it communicates
     nothing. Anonymous has to be a readable state, like every other state
     in this cast. */
  buyer: {
    body: STEEL, bodyDark: STEEL_DARK, head: STEEL_LIGHT, accent: ACCENT,
    scale: 1.06, broad: 1.06, brim: false, satchel: false, crest: false, carry: false, sealed: true,
  },
  /* Any address at all. `markDefault` is permissionless, so whoever calls it
     must visibly be NOBODY IN PARTICULAR — no satchel, no brim, no crest, no
     capital. The absence is the identity, and the plate beside them names
     it. */
  passerby: {
    body: STEEL_LIGHT, bodyDark: STEEL, head: PAPER, accent: PAPER,
    scale: 0.98, broad: 0.96, brim: false, satchel: false, crest: false, carry: false, sealed: false,
  },
};

export function makeFigure(
  parent: THREE.Object3D,
  kind: FigureKind,
  opts: FigureOpts = {},
): FigureHandle {
  const s = SPECS[kind];
  const accent = opts.accent ?? s.accent;
  const g = new THREE.Group();
  parent.add(g);

  softShadow(g, 1.5, 0.36);

  const body = new THREE.Group();
  body.scale.setScalar(s.scale);
  g.add(body);

  const B = s.broad;
  const OL = 0.05;

  // feet
  obox(body, 0.22 * B, 0.16, 0.26, s.bodyDark, -0.19 * B, 0.08, 0, { outlineThickness: OL });
  obox(body, 0.22 * B, 0.16, 0.26, s.bodyDark, 0.19 * B, 0.08, 0, { outlineThickness: OL });
  // waist
  obox(body, 0.62 * B, 0.24, 0.46, s.bodyDark, 0, 0.30, 0, { outlineThickness: OL });
  // chest
  obox(body, 0.82 * B, 0.78, 0.60, s.body, 0, 0.82, 0, { outlineThickness: OL });
  // shoulders
  obox(body, 0.18 * B, 0.34, 0.46, s.bodyDark, -0.50 * B, 0.96, 0, { outlineThickness: OL });
  obox(body, 0.18 * B, 0.34, 0.46, s.bodyDark, 0.50 * B, 0.96, 0, { outlineThickness: OL });
  // a chest mark — the one spot of accent, so the figures carry the palette
  // without needing colour to be told apart. The buyer has none: their
  // identifying mark is the commitment on the head, and nothing else.
  if (!s.sealed) {
    obox(body, 0.20, 0.20, 0.03, accent, 0, 0.86, 0.32, { outlineThickness: 0.035 });
  }
  // neck
  obox(body, 0.28, 0.14, 0.28, s.bodyDark, 0, 1.28, 0, { outlineThickness: OL });
  // head — a plain block. The face is added after the silhouette cues, so
  // the brim and the crest are the things that read first.
  obox(body, 0.62, 0.56, 0.58, s.head, 0, 1.63, 0, { outlineThickness: OL });

  if (s.brim) {
    // wide flat brim. The single silhouette cue that separates the factor
    // from the supplier at any distance.
    obox(body, 1.12, 0.09, 1.02, s.bodyDark, 0, 1.92, 0, { outlineThickness: OL });
    obox(body, 0.58, 0.20, 0.54, s.bodyDark, 0, 2.03, 0, { outlineThickness: OL });
  }

  if (s.sealed) {
    /* A commitment band where a face would be — the same device the invoice
       slab uses for its hash. Says "identified on chain, not by name". */
    obox(body, 0.52, 0.13, 0.03, accent, 0, 1.63, 0.30, { outlineThickness: 0.035 });
  }

  if (s.crest) {
    // A tall narrow crest. Deliberately the opposite silhouette to the
    // factor's wide brim, so the two never read as the same person at a
    // distance or in a desaturated frame.
    obox(body, 0.16, 0.46, 0.16, accent, 0, 2.10, 0, { outlineThickness: 0.045 });
    obox(body, 0.30, 0.10, 0.30, s.bodyDark, 0, 1.90, 0, { outlineThickness: 0.045 });
  }

  if (s.carry) {
    // Capital, held out in front — a funder is defined by what they bring.
    for (let i = 0; i < 3; i++) {
      obox(body, 0.52, 0.11, 0.36, accent, 0, 0.60 + i * 0.13, 0.44, {
        outlineThickness: 0.04,
      });
    }
  }

  if (s.satchel) {
    // satchel on one hip, on a strap across the chest
    obox(body, 0.40, 0.34, 0.20, accent, 0.52, 0.44, 0.10, { outlineThickness: OL });
    obox(body, 0.08, 0.72, 0.06, s.bodyDark, 0.20, 0.92, 0.30, { rz: -0.42, outlineThickness: 0.04 });
  }

  /* -- the face --------------------------------------------------------
     Two ink blocks and two brows on the head's front plane. No outline
     shells: at this size the shell is thicker than the feature and turns
     both eyes into one smudge. The buyer gets none — their commitment band
     already occupies the same plane, which is the point of it. */
  const eyes: THREE.Mesh[] = [];
  const brows: THREE.Mesh[] = [];
  if (!s.sealed) {
    for (const sx of [-1, 1]) {
      eyes.push(obox(body, 0.135, 0.155, 0.02, INK, sx * 0.145, 1.665, 0.295, { outline: false }));
      brows.push(obox(body, 0.185, 0.048, 0.02, INK, sx * 0.145, 1.820, 0.297, { outline: false }));
    }
  }

  const height = (s.brim ? 2.13 : s.crest ? 2.33 : 1.91) * s.scale;
  const phase = kind === "supplier" ? 0 : 1.7;
  /* Blink phase, from the kind and the accent rather than a counter, so two
     figures of the same kind on one stage do not blink in unison and the
     whole thing stays a pure function of t (§9). */
  const blinkPhase = ((accent % 977) / 977) * 6.283 + phase;
  let face: Expression = "neutral";

  return {
    g, kind, height,
    face(ry) { g.rotation.y = ry; },
    express(e) { face = e; },
    update(t, moving = 0) {
      /* Idle is a breath and the faintest weight shift — anything more and
         they compete with whatever the scene is actually about. `moving`
         blends in a step cadence, a forward lean and a little sway on top.
         Blended rather than switched, so a figure setting off or stopping
         does not snap (the walkingMix pattern from Talos's workshop/bot.tsx). */
      const m = Math.max(0, Math.min(1, moving));
      const idleY = Math.sin(t * 1.05 + phase) * 0.018;
      const stepY = Math.abs(Math.sin(t * 5.2 + phase)) * 0.085;
      body.position.y = idleY * (1 - m) + stepY * m;
      body.rotation.z = Math.sin(t * 0.47 + phase) * 0.010 * (1 - m)
        + Math.sin(t * 5.2 + phase) * 0.045 * m;
      body.rotation.x = -0.10 * m;   // lean into the walk

      if (!eyes.length) return;
      const [raise, tilt, open] = FACES[face];
      /* A blink every ~4.1s: a narrow, steep pulse, so it is a blink and not
         a slow close. Analytic, like every other transient in the deck. */
      const ph = (t / 4.1 + blinkPhase) % 1;
      const blink = ph > 0.972 ? Math.sin((ph - 0.972) / 0.028 * Math.PI) : 0;
      const openY = Math.max(0.06, open * (1 - blink));
      for (let i = 0; i < 2; i++) {
        const sx = i === 0 ? -1 : 1;
        eyes[i].scale.y = openY;
        // squinting and blinking both close from the TOP, like a lid
        eyes[i].position.y = 1.665 + 0.155 * (1 - openY) / 2;
        brows[i].position.y = 1.820 + raise;
        brows[i].rotation.z = -sx * tilt;
      }
    },
  };
}
