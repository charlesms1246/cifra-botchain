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
  kind?: "racks" | "spires" | "ridge";
  accent?: number;
  /** 0..1.5 multiplier on tower and light counts. 0 keeps ground + horizon. */
  density?: number;
  motes?: number;
  horizon?: boolean;
  ground?: boolean;
  seed?: number;
}

export interface EnvHandle {
  g: THREE.Group;
  update(t: number): void;
}

interface Tower { x: number; z: number; w: number; h: number; d: number }

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

  if (kind === "spires") {
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
    },
  };
}
