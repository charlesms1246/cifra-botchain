/* The review UI — a scene navigator for localhost:5173.
   ─────────────────────────────────────────────────────────────────────────
   Authoring only. It is marked `data-chrome="ui"` and BOTH capture scripts
   inject a rule hiding that attribute, so it can never end up in a frame.
   That is deliberately an explicit opt-out in the capture path rather than
   a guess inside the engine: a review control that leaks into the render is
   the kind of thing nobody notices until the video is cut.

   What it gives you:
     · every scene, its loop length, and which one is playing
     · a scrubber — click or drag anywhere on the bar to seek
     · space to play/pause · left/right to change scene · R to restart
     · 0-5 to jump straight to S0-S5
     · the live playhead, so a beat can be read off the frame and typed
       straight into the scene's schedule constant */

import type { Engine } from "./engine";

export interface SceneEntry {
  id: string;
  label: string;
  /** Verification stages are listed apart from the deck proper. */
  stage?: boolean;
}

export function mountUI(engine: Engine, scenes: SceneEntry[]): void {
  const root = document.createElement("div");
  root.dataset.chrome = "ui";
  root.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;z-index:50;" +
    "font:400 12px/1.3 ui-monospace,'JBMono',monospace;color:#f6f1ee;" +
    "background:linear-gradient(to top,rgba(11,9,8,.94),rgba(11,9,8,.72) 60%,transparent);" +
    "padding:14px 18px 12px;backdrop-filter:blur(6px);user-select:none";

  const bar = document.createElement("div");
  bar.style.cssText =
    "position:relative;height:6px;border-radius:3px;background:#f6f1ee1f;cursor:pointer;margin-bottom:11px";
  const fill = document.createElement("div");
  fill.style.cssText = "position:absolute;inset:0 auto 0 0;width:0;border-radius:3px;background:#de7356";
  bar.appendChild(fill);

  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:7px;flex-wrap:wrap";

  const playBtn = document.createElement("button");
  const btnCss =
    "border:1px solid #f6f1ee2e;background:#f6f1ee0d;color:#f6f1eeb5;border-radius:5px;" +
    "padding:5px 10px;font:inherit;letter-spacing:.09em;cursor:pointer;text-transform:uppercase";
  playBtn.style.cssText = btnCss + ";min-width:64px";

  const readout = document.createElement("span");
  readout.style.cssText = "margin-left:auto;color:#f6f1ee7a;letter-spacing:.08em;font-variant-numeric:tabular-nums";

  const buttons = new Map<string, HTMLButtonElement>();
  const mk = (s: SceneEntry) => {
    const b = document.createElement("button");
    b.style.cssText = btnCss;
    b.textContent = s.label;
    b.onclick = () => { location.hash = s.id; };
    buttons.set(s.id, b);
    return b;
  };

  row.appendChild(playBtn);
  const sep = () => {
    const d = document.createElement("span");
    d.style.cssText = "width:1px;height:18px;background:#f6f1ee24;margin:0 4px";
    return d;
  };
  row.appendChild(sep());
  for (const s of scenes.filter((x) => !x.stage)) row.appendChild(mk(s));
  const stages = scenes.filter((x) => x.stage);
  if (stages.length) {
    row.appendChild(sep());
    for (const s of stages) row.appendChild(mk(s));
  }
  row.appendChild(readout);

  root.appendChild(bar);
  root.appendChild(row);
  document.body.appendChild(root);

  /* ── scrubbing ─────────────────────────────────────────────────────── */
  const seekAt = (clientX: number) => {
    const r = bar.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    engine.setTime(p * engine.loop());
  };
  let dragging = false;
  bar.addEventListener("pointerdown", (e) => {
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    engine.pause();
    seekAt(e.clientX);
  });
  bar.addEventListener("pointermove", (e) => { if (dragging) seekAt(e.clientX); });
  bar.addEventListener("pointerup", (e) => { dragging = false; bar.releasePointerCapture(e.pointerId); });

  const toggle = () => (engine.playing() ? engine.pause() : engine.play());
  playBtn.onclick = toggle;

  /* ── keys ──────────────────────────────────────────────────────────── */
  const deck = () => scenes.filter((x) => !x.stage);
  window.addEventListener("keydown", (e) => {
    const list = deck();
    const i = list.findIndex((x) => x.id === engine.current());
    if (e.code === "Space") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowRight" && i >= 0) location.hash = list[(i + 1) % list.length].id;
    else if (e.key === "ArrowLeft" && i >= 0) location.hash = list[(i - 1 + list.length) % list.length].id;
    else if (e.key === "r" || e.key === "R") { engine.setTime(0); engine.play(); }
    else if (/^[0-9]$/.test(e.key)) {
      const hit = list.find((x) => x.id === `s${e.key}`);
      if (hit) location.hash = hit.id;
    }
  });

  /* ── paint ─────────────────────────────────────────────────────────── */
  const tick = () => {
    const cur = engine.current();
    for (const [id, b] of buttons) {
      const on = id === cur;
      b.style.color = on ? "#0b0908" : "#f6f1eeb5";
      b.style.background = on ? "#de7356" : "#f6f1ee0d";
      b.style.borderColor = on ? "#de7356" : "#f6f1ee2e";
    }
    const L = engine.loop();
    const t = engine.time();
    fill.style.width = L > 0 ? `${(t / L) * 100}%` : "0";
    playBtn.textContent = engine.playing() ? "Pause" : "Play";
    readout.textContent = `${t.toFixed(2)}s / ${L.toFixed(0)}s`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
