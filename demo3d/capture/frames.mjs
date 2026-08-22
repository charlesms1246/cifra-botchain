/* Render a scene to video — PLAN.md §11.
 *
 *   node capture/frames.mjs <scene> [--fps 60] [--seconds N] [--w 1920] [--h 1080]
 *                                   [--out out/<scene>.mp4] [--crf 16]
 *
 * Seeks the page to i/fps for every frame and pipes the PNG straight into
 * ffmpeg's stdin. Frames are never written to disk: a 34-second scene at
 * 60fps is ~2,000 1080p PNGs, which is over 3 GB for no benefit.
 *
 * This only works because every scene is a pure function of t (§9). The
 * renderer is not being watched in real time — it is being ASKED for frame
 * i, in order, at whatever rate the machine manages. Wall-clock speed has no
 * effect on the output, so a slow headless GPU costs minutes and changes
 * nothing about the result.
 *
 * `--seconds` defaults to the scene's own loop length, so the render is
 * exactly one seamless loop unless told otherwise.
 */

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };

const scene = args[0] ?? "s5";
const fps = Number(flag("fps", 60));
const width = Number(flag("w", 1920));
const height = Number(flag("h", 1080));
const crf = String(flag("crf", 16));
const out = resolve(flag("out", `out/${scene}.mp4`));
const base = flag("base", "http://localhost:5173");
const secondsArg = flag("seconds", null);

await mkdir(dirname(out), { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

let ff;
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("  [page]", e.message));

  await page.goto(`${base}/#${scene}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });
  await page.evaluate((n) => window.__goto(n), scene);

  // The review UI (src/ui.ts) is authoring-only. Hiding it here rather than
  // guessing inside the engine keeps the opt-out explicit: a scene navigator
  // that leaks into a render is not noticed until the video is cut.
  await page.addStyleTag({ content: '[data-chrome="ui"]{display:none!important}' });

  const loop = await page.evaluate(() => window.__loop());
  const seconds = secondsArg === null ? loop : Number(secondsArg);
  const total = Math.round(seconds * fps);

  console.log(`scene ${scene} · loop ${loop}s · rendering ${seconds}s @ ${fps}fps = ${total} frames · ${width}x${height}`);

  ff = spawn("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-crf", crf, "-preset", "slow",
    "-pix_fmt", "yuv420p",
    // Even dimensions are required by yuv420p; 1920x1080 is fine, but a
    // custom --w/--h could be odd and would fail deep inside the encode.
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    out,
  ], { stdio: ["pipe", "inherit", "inherit"] });

  const write = (buf) => new Promise((res, rej) => {
    if (ff.stdin.write(buf)) return res();
    ff.stdin.once("drain", res);
    ff.stdin.once("error", rej);
  });

  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    await page.evaluate((t) => window.__seek(t), i / fps);
    await write(await page.screenshot({ type: "png" }));
    if (i % 60 === 0 || i === total - 1) {
      const el = (Date.now() - t0) / 1000;
      const rate = i > 0 ? i / el : 0;
      const eta = rate > 0 ? Math.round((total - i) / rate) : 0;
      process.stdout.write(
        `\r  frame ${String(i + 1).padStart(5)}/${total}  ${rate.toFixed(1)} fps  eta ${eta}s   `,
      );
    }
  }
  process.stdout.write("\n");

  ff.stdin.end();
  await new Promise((res, rej) => {
    ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
  });
  console.log(`ok  ${out}`);
} finally {
  await browser.close();
}
