/* Toon/voxel primitives — the shared look.
   ─────────────────────────────────────────────────────────────────────────
   Ported from reference/Talos/components/tour/talos-agent.ts L19-131, with
   the constants changed to Cifra's palette. That file is a solved problem:
   the 5-step gradient with a hard inked shadow floor, the BackSide-shell
   outline trick, the lazily-built-and-rebuildable texture caches. Do not
   re-derive it.

   Why MeshToonMaterial and not Lambert: Talos's workshop scene uses Lambert
   (workshop/station.tsx), which gives soft falloff. The deck wants FLAT
   faces with hard steps between them so the ink outlines read — that is
   what makes voxel staging legible at 1080p and on a projector. */

import * as THREE from "three";
import { INK } from "./palette";

/* ── the 5-step toon ramp ─────────────────────────────────────────────── */

let GMAP: THREE.DataTexture | null = null;

export function gradientMap(): THREE.DataTexture {
  if (GMAP) return GMAP;
  // Five steps: enough to carve a cube's faces apart, few enough to stay
  // graphic. Talos's ramp starts at 72 and tops out at 255, which is right
  // for its saturated blues on a navy stage. Cifra's stock is near-white
  // paper (0xf6f1ee) — on that ramp a front-facing sheet landed on step 3
  // and rendered as muddy tan, because toon MULTIPLIES the ramp into the
  // colour. Lifted floor and mid so paper reads as paper and the steps
  // still separate.
  const data = new Uint8Array([
    108, 108, 108, 255, 156, 156, 156, 255, 200, 200, 200, 255,
    232, 232, 232, 255, 255, 255, 255, 255,
  ]);
  GMAP = new THREE.DataTexture(data, 5, 1, THREE.RGBAFormat);
  GMAP.minFilter = GMAP.magFilter = THREE.NearestFilter;
  GMAP.needsUpdate = true;
  return GMAP;
}

export const mat = (color: number) =>
  new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });

/** Flat, unlit fill — for things that emit rather than receive: screens,
 *  lit segments, fill levels. Keeps them from being dimmed by the key light. */
export const flat = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });

/* ── the outlined voxel box ───────────────────────────────────────────── */

export interface BoxOpts {
  rx?: number; ry?: number; rz?: number;
  outline?: boolean;
  outlineColor?: number;
  /** Outline shell thickness in world units. Scale it with the box: a 0.035
   *  shell on a 4-unit wall is invisible, on a 0.1-unit chip it is the whole
   *  object. */
  outlineThickness?: number;
  material?: THREE.Material;
}

/** An outlined box. The outline is a slightly larger BackSide shell, which
 *  costs one extra draw and needs no post-processing pass — the reason this
 *  look survives a headless capture with no EffectComposer in the pipeline. */
export function obox(
  parent: THREE.Object3D,
  w: number, h: number, d: number,
  color: number,
  x = 0, y = 0, z = 0,
  opts: BoxOpts = {},
): THREE.Mesh {
  const {
    rx = 0, ry = 0, rz = 0,
    outline = true, outlineColor = INK, outlineThickness = 0.035,
    material,
  } = opts;

  const geo = new THREE.BoxGeometry(w, h, d);
  const face = new THREE.Mesh(geo, material ?? mat(color));
  face.position.set(x, y, z);
  face.rotation.set(rx, ry, rz);
  parent.add(face);

  if (outline) {
    // Parent the shell TO the face and share its geometry, scaled up. Talos
    // keeps the two as siblings and has to move both in lockstep; every bug
    // that leaves an outline behind when a thing animates comes from that.
    // As a child it inherits every transform for free — which the invoice
    // slab relies on, since its states scale and rotate the face directly.
    const t = outlineThickness;
    const shell = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: outlineColor, side: THREE.BackSide }),
    );
    shell.scale.set((w + t) / w, (h + t) / h, (d + t) / d);
    face.add(shell);
  }
  return face;
}

/* ── glow sprite ──────────────────────────────────────────────────────── */

let GLOW: THREE.CanvasTexture | null = null;

function glowTex(): THREE.CanvasTexture {
  if (GLOW) return GLOW;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const x = cv.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 62);
  // Exponential-ish falloff. A linear ramp reads as a flat disc.
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.1, "rgba(255,255,255,1)");
  g.addColorStop(0.17, "rgba(255,255,255,.58)");
  g.addColorStop(0.28, "rgba(255,255,255,.30)");
  g.addColorStop(0.45, "rgba(255,255,255,.14)");
  g.addColorStop(0.65, "rgba(255,255,255,.055)");
  g.addColorStop(0.85, "rgba(255,255,255,.015)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  GLOW = new THREE.CanvasTexture(cv);
  return GLOW;
}

export function glowSprite(color: number, size: number, opacity = 0.8): THREE.Sprite {
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex(), color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  sp.scale.setScalar(size);
  return sp;
}

/* ── contact shadow ───────────────────────────────────────────────────── */

let SHADOW: THREE.CanvasTexture | null = null;

function shadowTex(): THREE.CanvasTexture {
  if (SHADOW) return SHADOW;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const x = cv.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, "rgba(0,0,0,0.6)");
  g.addColorStop(0.45, "rgba(0,0,0,0.34)");
  g.addColorStop(0.78, "rgba(0,0,0,0.1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  SHADOW = new THREE.CanvasTexture(cv);
  return SHADOW;
}

/** A soft blob under a thing. Without one, voxel objects float — and the
 *  invoice slab's `funded` state is literally "it lifts off the floor",
 *  which does not read at all if there was never a contact shadow to leave. */
export function softShadow(parent: THREE.Object3D, size = 3.2, opacity = 0.32) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: shadowTex(), transparent: true, opacity, depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  m.renderOrder = -1;
  parent.add(m);
  return m;
}

/* ── ground ───────────────────────────────────────────────────────────── */

/** The stage floor: a dark plane plus a faint grid. The grid is what gives
 *  the camera moves something to parallax against; without it a crane move
 *  over a flat floor reads as a zoom. */
export function gridFloor(
  parent: THREE.Object3D,
  size = 70,
  color = 0xde7356,
  opacity = 0.10,
): THREE.Group {
  const g = new THREE.Group();
  /* The floor WRITES DEPTH. It did not, which meant nothing could ever be
     hidden below the stage — and S5's risers need exactly that: a figure
     that descends has to actually disappear rather than sink through a
     transparent floor in full view. */
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 2, size * 2),
    new THREE.MeshBasicMaterial({ color: 0x0d0b0a }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -0.01;
  plane.renderOrder = -2;
  g.add(plane);

  const grid = new THREE.GridHelper(size, size / 2, color, color);
  const gm = grid.material as THREE.Material;
  gm.opacity = opacity;
  gm.transparent = true;
  grid.position.y = 0.005;
  g.add(grid);

  parent.add(g);
  return g;
}

/* ── lighting rig ─────────────────────────────────────────────────────── */

/** The deck's standard three-point-ish rig. Flat and directional: toon
 *  shading needs a dominant key to carve faces apart, and almost no fill or
 *  every face lands on the same ramp step and the silhouette goes mushy. */
export function stageLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0xf4ece8, 0.55));
  scene.add(new THREE.HemisphereLight(0xf0d8cc, 0x14100e, 0.40));

  // Key sits well forward as well as high: the deck is shot from the front,
  // and a purely overhead key leaves every face the camera can actually see
  // on the ramp's lower steps.
  const key = new THREE.DirectionalLight(0xffe9dc, 1.9);
  key.position.set(7, 13, 16);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xde7356, 0.30);
  rim.position.set(-13, 8, -9);
  scene.add(rim);
}

/** Drop every texture cache. Call on teardown — three re-uploads them on the
 *  next build, and holding a disposed texture is the classic "second open is
 *  black" bug (talos-agent.ts documents it at its dispose()). */
export function resetCaches(): void {
  GMAP = GLOW = SHADOW = null;
}
