/* Deck boot. Hash selects the scene: #cast, #s0 … #s7. */

import { createEngine } from "./engine";
import { mountUI, type SceneEntry } from "./ui";
import { castSheet } from "./scenes/cast-sheet";
import { castStructures } from "./scenes/cast-structures";
import { s0Trade } from "./scenes/s0-trade";
import { s1Commitment } from "./scenes/s1-commitment";
import { s2Grade } from "./scenes/s2-grade";
import { s3Attest } from "./scenes/s3-attest";
import { s4Vault } from "./scenes/s4-vault";
import { s5Waterfall } from "./scenes/s5-waterfall";
import { s6Governance } from "./scenes/s6-governance";
import { s7Deployed } from "./scenes/s6-deployed";

const canvas = document.getElementById("deck") as HTMLCanvasElement;

async function boot(): Promise<void> {
  const engine = await createEngine(canvas);

  /* One list, used for registration AND for the navigator, so a scene can
     never exist in the app but be missing from the review UI. */
  const SCENES: (SceneEntry & { make: () => import("./engine").Scene3D })[] = [
    { id: "s0", label: "S0 · Trade", make: s0Trade },
    { id: "s1", label: "S1 · Commitment", make: s1Commitment },
    { id: "s2", label: "S2 · Grade", make: s2Grade },
    { id: "s3", label: "S3 · Attest", make: s3Attest },
    { id: "s4", label: "S4 · Vault", make: s4Vault },
    { id: "s5", label: "S5 · Waterfall", make: s5Waterfall },
    { id: "s6", label: "S6 · Governance", make: s6Governance },
    { id: "s7", label: "S7 · Deployed", make: s7Deployed },
    { id: "cast", label: "Cast sheet", make: castSheet, stage: true },
    { id: "cast2", label: "Structures", make: castStructures, stage: true },
  ];
  for (const s of SCENES) engine.register(s.id, s.make);

  const pick = () => (location.hash.slice(1) || "s0");
  const start = pick();
  engine.goto(window.__scenes?.includes(start) ? start : "s0");
  engine.play();

  mountUI(engine, SCENES);

  window.addEventListener("hashchange", () => {
    const name = pick();
    if (window.__scenes?.includes(name)) { engine.goto(name); engine.play(); }
  });

  // The capture path polls this. Set LAST — after the first frame is on the
  // canvas — so a screenshot taken the moment it flips is never of an empty
  // buffer.
  engine.seek(0);
  window.__ready = true;
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<pre style="position:fixed;inset:2rem;color:#d2452f;font:14px monospace;white-space:pre-wrap">${String(err?.stack ?? err)}</pre>`,
  );
});
