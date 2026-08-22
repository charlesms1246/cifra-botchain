/* Render the WHOLE deck to one file — PLAN.md §11.
 *
 *   node capture/deck.mjs [--fps 60] [--w 1920] [--h 1080] [--out out/cifra.mp4]
 *                         [--crf 16] [--scenes s0,s1,…]
 *
 * One browser, one ffmpeg, seven scenes back to back. Not seven renders and a
 * concat: concatenating separately-encoded segments either re-encodes (a
 * second generation loss for nothing) or leaves a keyframe seam at every cut,
 * and this deck cuts hard between scenes already — a seam that lands ON a cut
 * is the one place you cannot tell it apart from a bug.
 *
 * Each scene runs exactly one loop, from t=0 to t=loop, EXCLUSIVE of the final
 * frame: t=loop is byte-identical to t=0 by construction (§9), so emitting it
 * would repeat a frame at every junction.
 */

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };

const fps = Number(flag("fps", 60));
const width = Number(flag("w", 1920));
const height = Number(flag("h", 1080));
const crf = String(flag("crf", 16));
const out = resolve(flag("out", "out/cifra-deck.mp4"));
const base = flag("base", "http://localhost:5173");
const scenes = String(flag("scenes", "s0,s1,s2,s3,s4,s5,s6")).split(",");

await mkdir(dirname(out), { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

let ff;
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("  [page]", e.message));

  await page.goto(`${base}/#${scenes[0]}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });
  await page.addStyleTag({ content: '[data-chrome="ui"]{display:none!important}' });

  // Measure first, so the log can state the real runtime before spending it.
  const plan = [];
  for (const s of scenes) {
    await page.evaluate((n) => window.__goto(n), s);
    const loop = await page.evaluate(() => window.__loop());
    plan.push({ id: s, loop, frames: Math.round(loop * fps) });
  }
  const total = plan.reduce((a, p) => a + p.frames, 0);
  const runtime = total / fps;
  console.log(
    `deck · ${plan.map((p) => `${p.id} ${p.loop}s`).join(" · ")}\n` +
    `total ${Math.floor(runtime / 60)}m ${String(Math.round(runtime % 60)).padStart(2, "0")}s ` +
    `= ${total} frames @ ${fps}fps · ${width}x${height}`,
  );

  ff = spawn("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-crf", crf, "-preset", "slow",
    "-pix_fmt", "yuv420p",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    out,
  ], { stdio: ["pipe", "inherit", "inherit"] });

  /* One listener pair per backpressure wait, BOTH removed on settle. Adding
     `once("error")` and leaving it when `drain` wins leaks a listener per
     frame, and at 12,000 frames node starts warning about it. */
  const write = (buf) => new Promise((res, rej) => {
    if (ff.stdin.write(buf)) return res();
    const done = (fn) => (v) => {
      ff.stdin.off("drain", onDrain);
      ff.stdin.off("error", onError);
      fn(v);
    };
    const onDrain = done(res);
    const onError = done(rej);
    ff.stdin.once("drain", onDrain);
    ff.stdin.once("error", onError);
  });

  const t0 = Date.now();
  let done = 0;
  for (const p of plan) {
    await page.evaluate((n) => window.__goto(n), p.id);
    for (let i = 0; i < p.frames; i++) {
      await page.evaluate((t) => window.__seek(t), i / fps);
      await write(await page.screenshot({ type: "png" }));
      done++;
      if (done % 60 === 0 || done === total) {
        const el = (Date.now() - t0) / 1000;
        const rate = done / el;
        process.stdout.write(
          `\r  ${p.id}  ${String(done).padStart(6)}/${total}  ` +
          `${rate.toFixed(1)} fps  eta ${Math.round((total - done) / rate)}s   `,
        );
      }
    }
  }
  process.stdout.write("\n");

  ff.stdin.end();
  await new Promise((res, rej) => {
    ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`))));
  });
  console.log(`ok  ${out}`);
} finally {
  await browser.close();
}
