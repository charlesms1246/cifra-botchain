import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  server: {
    fs: {
      // S6 imports frontend/lib/deployment.json directly rather than
      // retyping addresses onto the proof plate. PLAN.md §12 step 6 is
      // explicit about that: a plate typed by hand is a plate that goes
      // stale the first time a contract is redeployed, and nobody notices
      // until it is on screen.
      allow: [resolve(__dirname), resolve(__dirname, "../frontend")],
    },
  },
});
