/* One scene, one time, one PNG — the verification loop from PLAN.md §12.
 *
 *   node capture/still.mjs <scene> <t> <out.png> [--w 1920] [--h 1080] [--gray]
 *
 * Boots the dev server's page in headless chromium, waits for window.__ready
 * (fonts loaded, first frame drawn), then drives __goto + __seek and grabs
 * exactly that frame. Because the scene is a pure function of t (§9), the
 * same arguments always produce the same pixels — which is what makes "look
 * at the PNG" a check rather than a vibe.
 *
 * --gray desaturates the result. That is the silhouette test the whole cast
 * is designed around: if two states are only told apart by colour, they are
 * not told apart on a projector.
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const scene = args[0] ?? "cast";
const t = Number(args[1] ?? 0);
const out = resolve(args[2] ?? `out/${scene}-${args[1] ?? 0}.png`);
const width = Number(flag("w", 1920));
const height = Number(flag("h", 1080));
const base = flag("base", "http://localhost:5173");

await mkdir(dirname(out), { recursive: true });

const browser = await chromium.launch({
  args: [
    // Headless chromium falls back to SwiftShader for WebGL. That is fine —
    // it is deterministic, which matters more here than speed — but it must
    // be allowed to run at all.
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});

try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });

  page.on("console", (m) => {
    if (m.type() === "error") console.error("  [page]", m.text());
  });
  page.on("pageerror", (e) => console.error("  [page]", e.message));

  await page.goto(`${base}/#${scene}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });

  await page.evaluate(
    ([name, time]) => {
      window.__goto(name);
      window.__seek(time);
    },
    [scene, t],
  );

  // The review UI (src/ui.ts) is authoring-only. Hiding it here rather than
  // guessing inside the engine keeps the opt-out explicit: a scene navigator
  // that leaks into a render is not noticed until the video is cut.
  // --ui keeps it, for showing the navigator itself. Never use it for a
  // frame that goes in the cut.
  if (!has("ui")) {
    await page.addStyleTag({ content: '[data-chrome="ui"]{display:none!important}' });
  }

  if (has("gray")) {
    await page.addStyleTag({ content: "#deck{filter:grayscale(1) contrast(1.05)}" });
  }

  await page.screenshot({ path: out, type: "png" });
  console.log(`ok  ${scene} @ t=${t}  ->  ${out}  (${width}x${height}${has("gray") ? ", gray" : ""})`);
} finally {
  await browser.close();
}
