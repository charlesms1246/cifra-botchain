/* The deck engine — clock, scene registry, camera rig, deterministic seek.
   ─────────────────────────────────────────────────────────────────────────
   Structure follows reference/Talos/components/tour/talos-agent.ts:473-694
   (one factory owns a renderer, a scene and a loop; a dispose() that is
   actually complete). What is added here is §9: an authoring loop and a
   capture path that run THE SAME update(t), so what you preview is what
   renders.

   The contract every scene signs:
     update(t)   pure function of scene-local seconds. No accumulated state,
                 no clock reads, no Math.random. Called with an arbitrary t,
                 possibly going backwards, possibly skipping.
     camera(t)   likewise. The rig does no smoothing of its own — a scene
                 that wants an eased move expresses it as a function of t,
                 because a smoothed rig carries state across frames and would
                 make the same t render differently depending on arrival. */

import * as THREE from "three";
import { BG } from "./palette";
import { stageLights, resetCaches } from "./voxel";
import { fontsReady } from "./fonts";

export interface Shot {
  pos: [number, number, number];
  look: [number, number, number];
  fov: number;
}

export interface Caption {
  /** Names what you are looking at. Sentence case. */
  title: string;
  /** Says what it means. Sentence case. */
  sub: string;
  /** The one line at the bottom that advances the argument. */
  beat: string;
}

export interface Scene3D {
  /** Loop length in seconds. The engine wraps t into [0, loop). */
  loop: number;
  /** Called once. Add everything to `root`. */
  build(root: THREE.Group): void;
  /** Called every frame with scene-local time. Pure function of t. */
  update(t: number): void;
  /** The shot at time t. Hard cuts are just a step in this function. */
  camera(t: number): Shot;
  /** Chrome at time t, or null to show none. PLAN.md §3: a title block in
   *  the top-left and one beat line bottom-centre. That is all — the middle
   *  of the frame belongs to the staging. */
  caption?(t: number): Caption | null;
  dispose?(): void;
}

export interface Engine {
  register(name: string, make: () => Scene3D): void;
  goto(name: string): void;
  /** Set time, update, render — synchronously. The capture path calls this. */
  seek(t: number): void;
  /** Start the authoring loop (dt-accumulating, but into the same seek). */
  play(): void;
  pause(): void;
  current(): string | null;
  /** Playhead, in scene-local seconds. For the review UI's scrubber. */
  time(): number;
  setTime(t: number): void;
  playing(): boolean;
  /** Loop length of the active scene, 0 if none. */
  loop(): number;
  dispose(): void;
}

declare global {
  interface Window {
    __seek?: (t: number) => void;
    __goto?: (name: string) => void;
    __scenes?: string[];
    __ready?: boolean;
    __loop?: () => number;
  }
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<Engine> {
  // Nothing may draw before the faces are usable — see fonts.ts.
  await fontsReady();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(BG, 1);
  // Capture runs at deviceScaleFactor 1 and wants exactly the pixels it asks
  // for. Authoring on a hi-dpi laptop wants a bit more. Cap at 2.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  // Depth cue. Everything past the staging melts into the background rather
  // than ending on a hard edge — see meld/demo/parts/env.js on why a stage
  // that just stops reads as unfinished.
  scene.fog = new THREE.FogExp2(BG, 0.018);
  stageLights(scene);

  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
  const lookAt = new THREE.Vector3();

  /* ── caption chrome ────────────────────────────────────────────────────
     HTML, not geometry. Type in a 3D scene has to fight perspective, the
     fog and the toon ramp for legibility, and loses. As DOM it is crisp at
     any capture resolution and it costs nothing to restyle after a copy
     edit — which matters, because the beat lines ARE the voiceover script
     (§11) and they will change more often than the staging does. */
  const chrome = document.createElement("div");
  chrome.style.cssText =
    "position:fixed;inset:0;pointer-events:none;font-family:'Malinton',ui-sans-serif,sans-serif";
  chrome.innerHTML =
    `<div id="cap-title" style="position:absolute;left:4.2vw;top:5.5vh;max-width:34vw"></div>` +
    `<div id="cap-beat" style="position:absolute;left:0;right:0;bottom:6.5vh;text-align:center"></div>` +
    /* Chain attribution. Bottom-RIGHT, because the beat line owns
       bottom-centre and the title owns top-left — §3 allows exactly three
       pieces of chrome and this is the third. Quiet on purpose: it is an
       attribution, not a claim, and it must not compete with the beat it
       shares a frame with. */
    `<div id="cap-chain" style="position:absolute;right:4.2vw;bottom:6.5vh;display:flex;` +
    `align-items:center;gap:.75em;opacity:.62">` +
    `<span style="font:400 clamp(9px,.66vw,13px)/1 'Malinton',sans-serif;` +
    `letter-spacing:.22em;text-transform:uppercase;color:#f6f1ee99">Settled on</span>` +
    `<img src="/brand/bot-chain.svg" alt="BOT Chain" style="height:clamp(13px,1.05vw,21px);display:block">` +
    `</div>`;
  document.body.appendChild(chrome);
  const capTitle = chrome.querySelector("#cap-title") as HTMLDivElement;
  const capBeat = chrome.querySelector("#cap-beat") as HTMLDivElement;

  function paintCaption(c: Caption | null): void {
    if (!c) { capTitle.innerHTML = ""; capBeat.innerHTML = ""; return; }
    capTitle.innerHTML =
      `<div style="font:700 clamp(20px,2.05vw,40px)/1.15 'Malinton',sans-serif;color:#f6f1ee">${c.title}</div>` +
      `<div style="margin-top:.55em;font:400 clamp(13px,1.02vw,20px)/1.45 'Malinton',sans-serif;color:#f6f1eeaa">${c.sub}</div>`;
    capBeat.innerHTML =
      `<div style="display:inline-block;font:400 clamp(14px,1.18vw,23px)/1.5 'Malinton',sans-serif;color:#f6f1ee;` +
      `border-top:2px solid #de7356;padding-top:.7em;max-width:64vw">${c.beat}</div>`;
  }

  const factories = new Map<string, () => Scene3D>();
  const built = new Map<string, { root: THREE.Group; scene: Scene3D }>();
  let activeName: string | null = null;
  let active: { root: THREE.Group; scene: Scene3D } | null = null;

  function size(): void {
    const w = canvas.clientWidth || 1920;
    const h = canvas.clientHeight || 1080;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  size();
  const ro = new ResizeObserver(size);
  ro.observe(canvas);

  function goto(name: string): void {
    const make = factories.get(name);
    if (!make) throw new Error(`unknown scene: ${name}`);
    if (active) active.root.visible = false;

    let entry = built.get(name);
    if (!entry) {
      const root = new THREE.Group();
      const s = make();
      s.build(root);
      scene.add(root);
      entry = { root, scene: s };
      built.set(name, entry);
    }
    entry.root.visible = true;
    active = entry;
    activeName = name;
  }

  function seek(t: number): void {
    if (!active) return;
    const L = active.scene.loop;
    // Wrap, so a capture can run past the loop end and land on the same
    // frame it started from — which is how §8's seamless-loop rule is
    // actually verified rather than asserted.
    const tl = L > 0 ? ((t % L) + L) % L : t;
    active.scene.update(tl);
    paintCaption(active.scene.caption ? active.scene.caption(tl) : null);
    const shot = active.scene.camera(tl);
    camera.position.set(shot.pos[0], shot.pos[1], shot.pos[2]);
    lookAt.set(shot.look[0], shot.look[1], shot.look[2]);
    camera.lookAt(lookAt);
    if (camera.fov !== shot.fov) {
      camera.fov = shot.fov;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  }

  /* ── authoring loop ────────────────────────────────────────────────────
     Accumulates wall time into a t and hands it to the SAME seek(). There is
     deliberately no second code path: a preview that renders differently
     from the capture is worse than no preview. */
  let raf = 0;
  let playing = false;
  let last: number | null = null;
  let clock = 0;

  const frame = (now: number) => {
    if (!playing) return;
    raf = requestAnimationFrame(frame);
    if (last === null) { last = now; return; }
    clock += Math.min(0.05, (now - last) / 1000);
    last = now;
    seek(clock);
  };

  function play(): void {
    if (playing) return;
    playing = true;
    last = null;
    raf = requestAnimationFrame(frame);
  }
  function pause(): void {
    playing = false;
    cancelAnimationFrame(raf);
  }

  const onVisibility = () => {
    if (document.hidden) { if (playing) { pause(); playing = true; } }
    else if (playing) { last = null; raf = requestAnimationFrame(frame); }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const engine: Engine = {
    register(name, make) { factories.set(name, make); window.__scenes = [...factories.keys()]; },
    goto(name) { goto(name); clock = 0; seek(0); },
    seek,
    play,
    pause,
    current: () => activeName,
    time: () => (active ? ((clock % active.scene.loop) + active.scene.loop) % active.scene.loop : 0),
    setTime(t) { clock = t; seek(t); },
    playing: () => playing,
    loop: () => (active ? active.scene.loop : 0),
    dispose() {
      pause();
      document.removeEventListener("visibilitychange", onVisibility);
      chrome.remove();
      ro.disconnect();
      for (const { scene: s } of built.values()) s.dispose?.();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const m = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
        const mats = Array.isArray(m) ? m : m ? [m] : [];
        for (const mm of mats) {
          const any = mm as THREE.Material & { map?: THREE.Texture | null; gradientMap?: THREE.Texture | null };
          any.map?.dispose();
          any.gradientMap?.dispose();
          mm.dispose();
        }
      });
      renderer.dispose();
      resetCaches();
    },
  };

  // The capture surface. capture/still.mjs drives exactly these.
  window.__seek = (t: number) => { pause(); seek(t); };
  window.__goto = (name: string) => { engine.goto(name); };
  // capture/frames.mjs asks the scene how long it is, rather than being told
  // — so a loop length can be retuned in one place and the render follows.
  window.__loop = () => (active ? active.scene.loop : 0);

  return engine;
}
