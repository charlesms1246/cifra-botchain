/* Motion craft primitives — PLAN.md §6.
   ─────────────────────────────────────────────────────────────────────────
   Everything here is a PURE FUNCTION. No state, no clock reads, no random.
   That is what makes §9 hold: a scene composed only of these is reproducible
   frame for frame, which is what lets the deck be re-rendered after a copy
   edit instead of frozen at the first render.

   The easing set is deliberately small. meld/demo/CRAFT.md's diagnosis of
   mediocre 3D is "things move at constant speed and arrive without weight";
   the cure is eOutBack on arrivals and an arc instead of a lerp, not thirty
   easing curves. */

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Normalise v within [a,b] to 0..1, clamped. The workhorse: every beat in a
 *  scene is `seg(t, start, end)` fed through an easing. */
export const seg = (v: number, a: number, b: number) =>
  b === a ? (v >= b ? 1 : 0) : clamp((v - a) / (b - a));

/* ── easings ──────────────────────────────────────────────────────────── */

/** Slow in, slow out. The default for anything that starts and stops. */
export const eInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Fast out of the gate, settles. For things already in motion at t=0. */
export const eOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Slow start, accelerating. Anticipation windups and falls. */
export const eInCubic = (t: number) => t * t * t;

/** Overshoots slightly and settles. THE arrival easing — CRAFT.md is explicit
 *  that its absence is what makes motion read as machinery. */
export const eOutBack = (t: number, s = 1.70158) =>
  1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

/** A damped spring settle, for impacts that ring rather than stop dead.
 *  Returns an offset around 0 — add it, do not multiply. */
export const ring = (dt: number, amp = 0.09, decay = 5.5, freq = 13) =>
  dt < 0 ? 0 : amp * Math.exp(-dt * decay) * Math.cos(dt * freq);

/* ── arcs ─────────────────────────────────────────────────────────────── */

/** Travel from a to b with a sine-driven rise. CRAFT.md: "lerp between two
 *  points is a straight line and reads as machinery." Anything that flies —
 *  the advance leaving the pool, the grade card, the stamp — uses this. */
export function arc(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  t: number, height: number,
): [number, number, number] {
  return [
    lerp(ax, bx, t),
    lerp(ay, by, t) + Math.sin(t * Math.PI) * height,
    lerp(az, bz, t),
  ];
}

/* ── squash and stretch ───────────────────────────────────────────────── */

/** Volume-preserving squash. Pass the Y scale you want; get back the X/Z
 *  scale that keeps the mass constant. Widen as you flatten, or it reads as
 *  the object shrinking rather than compressing. */
export const volume = (sy: number): number => 1 / Math.sqrt(Math.max(sy, 1e-4));

/** The full anticipate → release → settle envelope around an impact at t=0.
 *  Returns a Y scale. Negative dt is the windup, positive is the ring-out.
 *
 *    dt < -crouch      1        (at rest)
 *    -crouch..-0       compress to 1-dip     (anticipation)
 *    0                 stretch to 1+pop      (release)
 *    0..               damped settle to 1    (follow-through) */
export function impactY(dt: number, crouch = 0.5, dip = 0.07, pop = 0.09): number {
  if (dt < -crouch) return 1;
  if (dt < -0.08) return 1 - dip * eInOut(seg(dt, -crouch, -0.08));
  if (dt < 0) { const q = seg(dt, -0.08, 0); return lerp(1 - dip, 1 + pop, q * q); }
  return 1 + ring(dt, pop);
}

/* ── loop helpers ─────────────────────────────────────────────────────── */

/** Time since `a` on a loop of length `L`. Always positive. */
export const since = (ph: number, a: number, L: number) => (ph - a + L) % L;

/** Signed delta to `a` on a loop of length L, in [-L/2, L/2). Use this for
 *  impact envelopes so the windup still plays when the beat is at ph ~0. */
export const sdel = (ph: number, a: number, L: number) =>
  ((ph - a + L * 1.5) % L) - L / 2;

/* ── determinism ──────────────────────────────────────────────────────── */

/** mulberry32. The ONLY source of randomness allowed in this deck — §9 bans
 *  Math.random outright, because a scene that lays out differently between
 *  runs cannot be re-rendered. Same seed, same frame, forever. */
export function prng(seed: number): () => number {
  let s = seed | 0 || 7;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
