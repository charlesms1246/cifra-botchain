/* Asset loading — fonts and brand marks.
   ─────────────────────────────────────────────────────────────────────────
   Everything the deck draws into a canvas has to be USABLE before the first
   frame, or the first frames bake a fallback into a texture that is then
   reused for the whole render (see the note in the font loader below). That
   is a §9 determinism failure, not a cosmetic one, so the engine awaits
   `assetsReady()` before it builds anything.

   `document.fonts.ready` covers the faces. Images need their own await —
   an <img> that has not decoded draws as nothing, silently. */

export const DISPLAY = "Malinton";
export const MONO = "JBMono";

/** BOT Chain's own green, taken from the supplied mark, not eyeballed. */
export const BOT_GREEN = 0x10a37f;

/** The lockup: glyph + "BOT Chain" wordmark, white on transparent. */
export let botChainLogo: HTMLImageElement | null = null;

/** Cifra's own marks — the wordmark (white) and the round terracotta icon. */
export let cifraWordmark: HTMLImageElement | null = null;
export let cifraIcon: HTMLImageElement | null = null;

/** Natural width of the glyph portion of the lockup, in the SVG's own user
 *  units, so the mark can be cropped out of the wordmark for tight spots. */
export const GLYPH_FRACTION = 148 / 1031;

async function loadFont(family: string, url: string, weight: string): Promise<void> {
  const face = new FontFace(family, `url(${url})`, { weight, style: "normal" });
  await face.load();
  document.fonts.add(face);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

let promise: Promise<void> | null = null;

export function assetsReady(): Promise<void> {
  if (promise) return promise;
  promise = (async () => {
    const [, , , , logo, word, icon] = await Promise.all([
      loadFont(DISPLAY, "/fonts/Malinton-Regular.otf", "400"),
      loadFont(DISPLAY, "/fonts/Malinton-Bold.otf", "700"),
      loadFont(MONO, "/fonts/JetBrainsMono-Regular.woff2", "400"),
      loadFont(MONO, "/fonts/JetBrainsMono-Bold.woff2", "700"),
      loadImage("/brand/bot-chain.svg"),
      loadImage("/brand/cifra-wordmark.svg"),
      loadImage("/brand/cifra-icon.svg"),
    ]);
    botChainLogo = logo;
    cifraWordmark = word;
    cifraIcon = icon;
    // Settles once the faces are actually usable for layout. Awaiting only
    // the FontFace promises can still race the first ctx.fillText.
    await document.fonts.ready;
    // An SVG <img> can report complete before it is decodable on some
    // builds; decode() is the guarantee that drawImage will paint.
    for (const img of [logo, word, icon]) {
      if (img.decode) { try { await img.decode(); } catch { /* already decoded */ } }
    }
  })();
  return promise;
}

/** Draw an image fitted to a width, returning the height it occupied. */
function drawFitted(
  c: CanvasRenderingContext2D, img: HTMLImageElement | null,
  x: number, y: number, w: number,
): number {
  if (!img) return 0;
  const h = (w * (img.naturalHeight || 1)) / (img.naturalWidth || 1);
  c.drawImage(img, x, y, w, h);
  return h;
}

export const drawCifraWordmark = (
  c: CanvasRenderingContext2D, x: number, y: number, w: number,
): number => drawFitted(c, cifraWordmark, x, y, w);

export const drawCifraIcon = (
  c: CanvasRenderingContext2D, x: number, y: number, w: number,
): number => drawFitted(c, cifraIcon, x, y, w);

/** Draw the BOT Chain lockup into a canvas, fitted to a width.
 *  `glyphOnly` crops to the mark for places too tight for the wordmark. */
export function drawBotChain(
  c: CanvasRenderingContext2D,
  x: number, y: number, w: number,
  glyphOnly = false,
): number {
  const img = botChainLogo;
  if (!img) return 0;
  const natW = img.naturalWidth || 1031;
  const natH = img.naturalHeight || 205;
  if (glyphOnly) {
    const sw = natW * GLYPH_FRACTION;
    const h = (w * natH) / sw;
    c.drawImage(img, 0, 0, sw, natH, x, y, w, h);
    return h;
  }
  const h = (w * natH) / natW;
  c.drawImage(img, x, y, w, h);
  return h;
}
