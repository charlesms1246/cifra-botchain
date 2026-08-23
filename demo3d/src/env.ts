/* The backdrop — PLAN.md §4.5.
   ─────────────────────────────────────────────────────────────────────────
   A TypeScript port of reference/meld/demo/parts/env.js, retinted to Cifra.
   Its own header comment is the spec and it is worth reading; the summary is
   that a stage which ends in blackness a few floor-tiles out reads as an
   unfinished set rather than as night. This closes the world:

     GROUND   a dark plane running far back, so the stage floor sits ON
              something and the fog has a surface to eat
     HORIZON  a faint accent glow band where ground meets sky
     SKYLINE  three depth layers of distant blocks, seeded
     LIGHTS   dim LED strips and beacons — a sleeping district, not a show
     MOTES    a few drifting points, for parallax on the crane moves

   IT IS A BACKDROP. Everything is silhouette-dark, nothing is outlined
   (crisp ink edges out here would pull focus off the staging), nothing
   pulses faster than a ~12s breath, and the near layer keeps a clear avenue
   down the middle so the centre of frame always belongs to the scene. If
   your eye goes to the scenery, turn `density` down.

   No Math.random: the layout comes from a seeded PRNG, so the same seed
   gives the same world frame for frame and captures reproduce (§9). */

import * as THREE from "three";
import { BG, ACCENT, css } from "./palette";
import { prng } from "./craft";
import { glowSprite } from "./voxel";

export interface EnvOpts {
  kind?: "racks" | "spires" | "ridge" | "freight";
  accent?: number;
  /** 0..1.5 multiplier on tower and light counts. 0 keeps ground + horizon. */
  density?: number;
  motes?: number;
  horizon?: boolean;
  ground?: boolean;
  seed?: number;
  /** The SCENE's loop length, in seconds. Required for the freight yard's
   *  moving traffic and ignored otherwise — see `movers` below. Without it
   *  the yard is built static, which is the safe failure. */
  loop?: number;
}

export interface EnvHandle {
  g: THREE.Group;
  update(t: number): void;
}

interface Tower { x: number; z: number; w: number; h: number; d: number }
/** A box placed at an explicit height — container tiers, crane beams. */
interface Slab { x: number; y: number; z: number; w: number; h: number; d: number }

/* A silhouette that crosses the yard: a ship, a train, a truck.
   ─────────────────────────────────────────────────────────────────────────
   THE HARD CONSTRAINT IS THE SEAM. Every scene loops, and a backdrop that
   does not land on the same frame at t=loop as at t=0 breaks the one
   property the whole capture pipeline rests on (§9). So a mover crosses a
   WHOLE number of times per loop and its position is `((t/loop)*laps +
   phase) mod 1` — which is phase at t=0 and phase again at t=loop, exactly,
   with no accumulated state to drift.

   That is why `loop` is a required option for traffic: if a scene does not
   declare its own loop length there is no period that provably closes, and
   the yard is built static instead of built wrong. */
interface Mover {
  g: THREE.Group;
  span: number;   // half the travel, wider than the visible span so it wraps off-frame
  laps: number;   // whole crossings per loop
  phase: number;
  dir: 1 | -1;
}

export function makeEnvironment(parent: THREE.Object3D, opts: EnvOpts = {}): EnvHandle {
  const kind = opts.kind ?? "racks";
  const dens = Math.max(0, Math.min(1.5, opts.density ?? 1));
  const acc = opts.accent ?? ACCENT;
  const nMotes = Math.max(0, Math.min(24, opts.motes ?? 8));
  const R = prng(opts.seed ?? 7);
  const rr = (a: number, b: number) => a + R() * (b - a);

  const g = new THREE.Group();
  parent.add(g);

  /* Silhouette shades: a value ramp from "just above the stage" down to
     "almost the sky". Warm-shifted from meld's greens to sit under Cifra's
     terracotta without reading as a second hue. */
  const NEAR_C = new THREE.Color(0x1b1512);
  const MID_C = new THREE.Color(0x141010);
  const FAR_C = new THREE.Color(0x100d0c);

  /* ── ground ───────────────────────────────────────────────────────── */
  if (opts.ground !== false) {
    const gr = new THREE.Mesh(
      new THREE.PlaneGeometry(1300, 640),
      new THREE.MeshBasicMaterial({ color: 0x0d0a09, depthWrite: false }),
    );
    gr.rotation.x = -Math.PI / 2;
    gr.position.set(0, -0.24, -160);
    gr.renderOrder = -3;
    g.add(gr);
  }

  /* ── horizon glow ─────────────────────────────────────────────────────
     Fog OFF: at z -240 the fog would eat it entirely, so its dimness is
     baked into the gradient instead. Towers depth-test against it, which is
     what makes the skyline read as shapes AGAINST a glow. */
  if (opts.horizon !== false) {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 256;
    const x = cv.getContext("2d")!;
    const gd = x.createLinearGradient(0, 0, 0, 256);
    gd.addColorStop(0.00, css(acc, 0));
    gd.addColorStop(0.40, css(acc, 0.06));
    gd.addColorStop(0.58, css(acc, 0.18));
    gd.addColorStop(0.74, css(acc, 0.42));   // the line itself
    gd.addColorStop(0.86, css(acc, 0.10));
    gd.addColorStop(1.00, css(acc, 0));
    x.fillStyle = gd;
    x.fillRect(0, 0, 512, 256);
    // Horizontal falloff — the band must die out before its geometric edge,
    // or a hard vertical seam walks into wide frames.
    const hf = x.createLinearGradient(0, 0, 512, 0);
    hf.addColorStop(0, "rgba(0,0,0,0)");
    hf.addColorStop(0.22, "rgba(0,0,0,1)");
    hf.addColorStop(0.78, "rgba(0,0,0,1)");
    hf.addColorStop(1, "rgba(0,0,0,0)");
    x.globalCompositeOperation = "destination-in";
    x.fillStyle = hf;
    x.fillRect(0, 0, 512, 256);

    const hz = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 46),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0.34,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }),
    );
    hz.position.set(0, 11, -240);
    g.add(hz);
  }

  /* ── skyline ──────────────────────────────────────────────────────── */
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const towers: Tower[] = [];

  function layer(
    n: number, col: THREE.Color,
    zA: number, zB: number, xR: number,
    wA: number, wB: number, hMax: number,
    dA: number, dB: number, gap: number,
  ): void {
    n = Math.round(n * dens);
    if (n <= 0) return;
    // Six cluster centres across the span — machines come in blocks, with
    // gaps between them. An even scatter reads as noise.
    const NC = 6, cw = rr(5, 8), cx: number[] = [];
    for (let i = 0; i < NC; i++) {
      cx.push(-xR + (i + 0.5) * ((2 * xR) / NC) + (R() - 0.5) * xR * 0.22);
    }
    const list: Tower[] = [];
    for (let i = 0; i < n; i++) {
      const x = cx[(R() * NC) | 0] + (R() + R() - 1) * cw;
      if (gap && Math.abs(x) < gap) continue;        // the centre avenue
      const w = rr(wA, wB), d = rr(dA, dB);
      let h = 0.7 + Math.pow(R(), 1.7) * hMax;       // mostly low, few tall
      // Keep the top-LEFT of frame clear: that is where every scene's title
      // block sits (§3), and a tall silhouette behind type is unreadable.
      if (x < -8) h = Math.min(h, hMax * 0.5);
      list.push({ x, z: rr(zA, zB), w, h, d });
    }
    if (!list.length) return;

    const im = new THREE.InstancedMesh(
      boxGeo, new THREE.MeshBasicMaterial({ color: col }), list.length,
    );
    const M = new THREE.Matrix4(), C = new THREE.Color();
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      M.makeScale(t.w, t.h, t.d);
      M.setPosition(t.x, t.h / 2 - 0.2, t.z);        // feet in the ground
      im.setMatrixAt(i, M);
      C.copy(col).multiplyScalar(rr(0.82, 1.14));    // subtle value jitter
      im.setColorAt(i, C);
      towers.push(t);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    g.add(im);
  }

  /* ── freight ──────────────────────────────────────────────────────
     A container yard under gantry cranes, instead of the generic blocks the
     other three kinds draw. It is the right backdrop on the merits, not just
     for the look: freight is the trade that actually runs on invoices at
     volume — long terms, thin margins, a counterparty on the other side of
     an ocean — so a stage that ends in a port names the customer rather than
     decorating for one.

     What makes it read as a yard rather than as more boxes is the MODULE.
     Every container is the same 5:1:1 slab, they stack in tiers on a shared
     footprint, and the gantries that straddle them repeat one silhouette at
     three depths. Randomness lives only in where a stack goes and how high
     it is; the unit never varies, which is the opposite of the scatter the
     other kinds use. */

  function emit(list: Slab[], col: THREE.Color): void {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(
      boxGeo, new THREE.MeshBasicMaterial({ color: col }), list.length,
    );
    const M = new THREE.Matrix4(), C = new THREE.Color();
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      M.makeScale(b.w, b.h, b.d);
      M.setPosition(b.x, b.y, b.z);
      im.setMatrixAt(i, M);
      C.copy(col).multiplyScalar(rr(0.84, 1.16));
      im.setColorAt(i, C);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    g.add(im);
  }

  /** Container stacks: n footprints, each 1..maxHigh tiers of one module. */
  function yard(
    n: number, col: THREE.Color,
    zA: number, zB: number, xR: number,
    u: number, maxHigh: number, gap: number,
  ): void {
    n = Math.round(n * dens);
    if (n <= 0) return;
    const out: Slab[] = [];
    const NC = 5, cx: number[] = [];
    for (let i = 0; i < NC; i++) {
      cx.push(-xR + (i + 0.5) * ((2 * xR) / NC) + (R() - 0.5) * xR * 0.18);
    }
    for (let i = 0; i < n; i++) {
      const bx = cx[(R() * NC) | 0] + (R() + R() - 1) * u * 6.5;
      if (gap && Math.abs(bx) < gap) continue;
      const bz = rr(zA, zB);
      const w = u * rr(4.4, 5.6);          // a container is long and low
      const d = u * rr(0.95, 1.15);
      // Same clearance rule as `layer`: the title block owns the top left.
      let high = 1 + ((R() * maxHigh) | 0);
      if (bx < -8) high = Math.min(high, Math.max(1, Math.round(maxHigh / 2)));
      for (let k = 0; k < high; k++) {
        /* Tiers are offset a little, never aligned. A perfectly stacked
           column extrudes into one tall box and the module disappears —
           which is the whole thing this backdrop has to keep. */
        out.push({
          x: bx + (R() - 0.5) * u * 0.55,
          y: u * (k + 0.5) - 0.2,
          z: bz + (R() - 0.5) * u * 0.35,
          w, h: u * 0.94, d,
        });
      }
      towers.push({ x: bx, z: bz, w, h: u * high, d });   // LED strips find these
    }
    emit(out, col);
  }

  /** Portal gantries straddling the yard: two legs and a spanning beam. */
  function gantries(
    n: number, col: THREE.Color,
    zA: number, zB: number, xR: number,
    u: number, gap: number,
  ): void {
    n = Math.round(n * dens);
    if (n <= 0) return;
    const out: Slab[] = [];
    for (let i = 0; i < n; i++) {
      const x = (R() * 2 - 1) * xR;
      const span = u * rr(7, 11);
      if (gap && Math.abs(x) < gap + span / 2) continue;
      const z = rr(zA, zB);
      /* Tall. A container port is a LOW field of boxes with tall cranes
         standing over it, and the cranes are the whole silhouette — at the
         same height as the stacks the yard reads as one dark band and the
         backdrop says nothing. */
      const h = u * rr(5.4, 8.2) * (x < -8 ? 0.55 : 1);
      const leg = u * 0.42, dep = u * 0.55;
      for (const sx of [-1, 1]) {
        out.push({ x: x + sx * span / 2, y: h / 2 - 0.2, z, w: leg, h, d: dep });
      }
      // the beam, and the trolley hanging under it
      out.push({ x, y: h - 0.2 + u * 0.22, z, w: span + leg * 2, h: u * 0.44, d: dep * 1.15 });
      out.push({
        x: x + (R() - 0.5) * span * 0.5, y: h - 0.2 - u * 0.25, z,
        w: u * 0.7, h: u * 0.5, d: dep,
      });
    }
    emit(out, col);
  }

  if (kind === "freight") {
    /* Low field, tall cranes — that contrast IS the silhouette.
       The near layer sits further back than the other kinds put theirs
       (-42 rather than -30): a gantry is the tallest thing this backdrop
       draws, and at 30 units its legs came down through the caption block
       in the top left. It is scenery; it gets the distance. */
    yard(18, NEAR_C, -42, -62, 34, 1.05, 3, 8);
    gantries(3, NEAR_C, -44, -60, 30, 1.15, 10);
    yard(28, MID_C, -70, -108, 48, 1.8, 3, 0);
    gantries(6, MID_C, -74, -104, 44, 2.0, 0);
    yard(36, FAR_C, -124, -205, 72, 3.0, 3, 0);
    gantries(6, FAR_C, -132, -198, 64, 3.3, 0);
  } else if (kind === "spires") {
    layer(22, NEAR_C, -30, -52, 34, 0.9, 1.9, 4.6, 0.9, 1.8, 7);
    layer(36, MID_C, -64, -104, 48, 1.1, 2.6, 7.5, 1.1, 2.4, 0);
    layer(50, FAR_C, -120, -205, 72, 1.6, 3.6, 9.0, 1.6, 3.4, 0);
  } else if (kind === "ridge") {
    layer(10, NEAR_C, -34, -52, 36, 3.5, 8.0, 1.6, 3.0, 6.0, 8);
    layer(14, MID_C, -66, -104, 50, 4.0, 9.0, 3.0, 3.5, 7.0, 0);
    layer(18, FAR_C, -122, -205, 74, 5.0, 11.0, 5.0, 4.0, 8.0, 0);
  } else {
    layer(24, NEAR_C, -30, -52, 34, 1.6, 3.8, 3.1, 1.2, 2.8, 7);
    layer(38, MID_C, -64, -104, 48, 2.0, 5.0, 5.5, 1.6, 3.4, 0);
    layer(52, FAR_C, -120, -205, 72, 2.5, 7.0, 8.0, 2.0, 4.5, 0);
  }

  /* ── LED strips: what says "running" rather than "empty buildings" ── */
  if (kind !== "ridge" && dens > 0) {
    const cands = towers.filter((t) => t.z > -105 && t.h > 1.5);
    const slots: { x: number; h: number; z: number }[] = [];
    for (const t of cands) {
      if (R() > 0.42 || slots.length >= Math.round(20 * dens)) continue;
      slots.push({
        x: t.x + (R() - 0.5) * t.w * 0.45,
        h: t.h * rr(0.35, 0.6),
        z: t.z + t.d / 2 + 0.03,
      });
    }
    if (slots.length) {
      const ledCol = new THREE.Color(acc).lerp(new THREE.Color(0xb39a92), 0.35);
      const im = new THREE.InstancedMesh(
        boxGeo,
        new THREE.MeshBasicMaterial({
          color: ledCol, transparent: true, opacity: 0.5, depthWrite: false,
        }),
        slots.length,
      );
      const M = new THREE.Matrix4();
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        M.makeScale(0.07, s.h, 0.05);
        M.setPosition(s.x, 0.12 + s.h / 2, s.z);
        im.setMatrixAt(i, M);
      }
      im.instanceMatrix.needsUpdate = true;
      g.add(im);
    }
  }

  /* ── traffic ──────────────────────────────────────────────────────
     Ships on the horizon, trains across the middle distance, trucks on the
     near road. A yard is a place where things are MOVING — a still one is a
     yard at 3am, which is a different and much less interesting claim about
     the trade this deck is financing.

     Kept honest to §4.5's rule that the eye must not go to the scenery:
     silhouette-dark in their layer's own colour, no lights of their own, no
     outlines, and ONE crossing per loop, so nothing out here ever moves
     faster than the slowest thing on stage. */
  const movers: Mover[] = [];

  function body(gr: THREE.Group, col: THREE.Color,
    x: number, y: number, w: number, h: number, d: number): void {
    const m = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: col }));
    m.scale.set(w, h, d);
    m.position.set(x, y, 0);
    gr.add(m);
  }

  /* A mover sits IN FRONT of the yard layer it belongs to and is a step
     lighter than it. Built in the layer's own colour and dropped inside the
     layer's own depth band, a moving silhouette is invisible against a
     static one of identical value — the backdrop just shimmers, which is
     the worst of both: motion the eye catches and nothing it can name. */
  function addMover(build: (gr: THREE.Group, col: THREE.Color) => void,
    base: THREE.Color, lift: number, z: number,
    span: number, laps: number, dir: 1 | -1): void {
    const gr = new THREE.Group();
    build(gr, base.clone().multiplyScalar(lift));
    gr.position.z = z;
    if (dir < 0) gr.rotation.y = Math.PI;
    g.add(gr);
    movers.push({ g: gr, span, laps, phase: R(), dir });
  }

  /** A container ship: long hull, deck stacks, a bridge block aft. */
  function ship(u: number) {
    return (gr: THREE.Group, col: THREE.Color): void => {
      body(gr, col, 0, u * 0.75, u * 26, u * 1.5, u * 3.4);
      for (let i = 0; i < 7; i++) {
        const bx = -u * 10 + i * u * 2.9;
        const tiers = 1 + ((R() * 3) | 0);
        for (let k = 0; k < tiers; k++) {
          body(gr, col, bx, u * (1.5 + k * 0.75), u * 2.5, u * 0.7, u * 3.0);
        }
      }
      body(gr, col, u * 10.4, u * 2.6, u * 2.8, u * 2.4, u * 3.2);   // bridge
      body(gr, col, u * 10.4, u * 4.4, u * 0.8, u * 1.4, u * 0.9);   // funnel
    };
  }

  /** A freight train: locomotive plus flat wagons carrying one box each. */
  function train(u: number) {
    return (gr: THREE.Group, col: THREE.Color): void => {
      body(gr, col, 0, u * 0.9, u * 3.0, u * 1.8, u * 1.2);          // loco
      for (let i = 1; i <= 5; i++) {
        const bx = -i * u * 4.6;
        body(gr, col, bx, u * 0.35, u * 4.2, u * 0.45, u * 1.1);     // flat
        body(gr, col, bx, u * 1.05, u * 3.6, u * 0.95, u * 1.0);     // container
      }
    };
  }

  /** A truck: cab, trailer, and enough wheel to break the box. */
  function truck(u: number) {
    return (gr: THREE.Group, col: THREE.Color): void => {
      body(gr, col, u * 2.4, u * 0.85, u * 1.4, u * 1.3, u * 1.0);   // cab
      body(gr, col, -u * 0.6, u * 1.0, u * 4.6, u * 1.5, u * 1.05);  // trailer
      for (const wx of [u * 2.4, -u * 1.6, -u * 2.5]) {
        body(gr, col, wx, u * 0.2, u * 0.5, u * 0.4, u * 1.15);
      }
    };
  }

  if (kind === "freight" && opts.loop && dens > 0) {
    /* Lifts tuned by eye against a 4x-brightened frame: at 1.5x they were
       technically present and practically invisible, which is a moving
       backdrop nobody can see. These sit a clear step above their layer and
       still well under anything on stage. Trucks ride INSIDE the near yard's
       depth band rather than in front of it — closer, they crossed the
       bottom of wide frames as unexplained pale blocks. */
    addMover(ship(3.2), FAR_C, 2.45, -120, 190, 1, 1);
    addMover(ship(2.7), FAR_C, 2.15, -142, 205, 1, -1);
    addMover(train(1.7), MID_C, 2.30, -68, 122, 1, -1);
    addMover(train(1.5), MID_C, 2.05, -60, 112, 1, 1);
    addMover(truck(0.95), NEAR_C, 2.10, -44, 74, 1, 1);
    addMover(truck(0.90), NEAR_C, 1.90, -40, 72, 1, -1);
  }

  /* ── beacons on the tallest far towers ────────────────────────────── */
  const beacons: { s: THREE.Sprite; o0: number; ph: number }[] = [];
  if (kind !== "ridge" && dens > 0) {
    const far = towers.filter((t) => t.z < -110).sort((a, b) => b.h - a.h).slice(0, 5);
    far.forEach((t, i) => {
      const sp = glowSprite(i % 2 ? 0xc4b4ae : acc, 1.1, 0.09);
      sp.position.set(t.x, t.h + rr(0.2, 0.7), t.z);
      sp.material.fog = false;
      g.add(sp);
      beacons.push({ s: sp, o0: 0.09, ph: rr(0, 9) });
    });
  }

  /* ── motes ────────────────────────────────────────────────────────── */
  const motes: {
    s: THREE.Sprite; bx: number; by: number;
    ax: number; ay: number; w1: number; w2: number; p1: number; p2: number;
  }[] = [];
  for (let i = 0; i < nMotes; i++) {
    const sp = glowSprite(i % 3 ? acc : 0xd4c4bc, rr(0.28, 0.55), rr(0.045, 0.08));
    const bx = rr(-22, 22), by = rr(0.8, 6), bz = rr(-12, -38);
    sp.position.set(bx, by, bz);
    g.add(sp);
    motes.push({
      s: sp, bx, by,
      ax: rr(0.5, 1.3), ay: rr(0.25, 0.6),
      w1: rr(0.04, 0.09), w2: rr(0.05, 0.1),
      p1: rr(0, 9), p2: rr(0, 9),
    });
  }

  void BG;

  return {
    g,
    update(t) {
      // All analytic — a sine per mote axis, a sine per beacon. A given t
      // always produces the same frame.
      for (const m of motes) {
        m.s.position.x = m.bx + Math.sin(t * m.w1 + m.p1) * m.ax;
        m.s.position.y = m.by + Math.sin(t * m.w2 + m.p2) * m.ay;
      }
      for (const b of beacons) {
        b.s.material.opacity = b.o0 * (0.78 + 0.22 * Math.sin(t * 0.5 + b.ph));
      }
      /* Traffic. `laps` whole crossings per loop, so u is the same at t=0 and
         t=loop and the seam closes exactly — see the Mover comment. */
      const L = opts.loop ?? 1;
      for (const m of movers) {
        const u = ((((t / L) * m.laps + m.phase) % 1) + 1) % 1;
        m.g.position.x = m.dir > 0 ? -m.span + u * 2 * m.span : m.span - u * 2 * m.span;
      }
    },
  };
}
