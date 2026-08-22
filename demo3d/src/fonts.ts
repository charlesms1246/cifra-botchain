/* Kept as the font-facing entry point. Loading now lives in assets.ts, which
   also owns the brand marks — everything that must be decoded before the
   first draw is awaited in one place, so there is exactly one gate. */
export { DISPLAY, MONO, assetsReady as fontsReady } from "./assets";
