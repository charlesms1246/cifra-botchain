/* Second verification stage: the scoring room and the basins.
   Not a deck scene. See cast-sheet.ts for why these exist. */

import type { Scene3D, Shot } from "../engine";
import { gridFloor } from "../voxel";
import { ACCENT } from "../palette";
import { makeRoom, type RoomHandle, TERMS } from "../cast/room";
import { makeBasins, type BasinsHandle } from "../cast/basins";
import { makeFigure, type FigureHandle } from "../cast/figure";
import { makeEnvironment, type EnvHandle } from "../env";

export function castStructures(): Scene3D {
  let room: RoomHandle;
  let basins: BasinsHandle;
  let figures: FigureHandle[] = [];
  let env: EnvHandle;

  return {
    loop: 12,

    build(root) {
      env = makeEnvironment(root, { kind: "racks", density: 0.85, motes: 8 });
      gridFloor(root, 60, ACCENT, 0.09);

      room = makeRoom(root);
      room.g.position.set(-4.6, 0, 0);
      // Two terms weighed, two not — so the lit and unlit states can be
      // compared in one frame rather than assumed.
      room.setTermLit(0, 1);
      room.setTermLit(1, 1);
      room.setTermLit(2, 0);
      room.setTermLit(3, 0);

      basins = makeBasins(root, { book: "BOT" });
      basins.g.position.set(5.2, 0, 0);
      // A funded book mid-life: both tranches carrying capital.
      basins.setLevel("senior", 0.78);
      basins.setLevel("junior", 0.62);

      // The two figures, side by side, so the silhouette difference can be
      // checked rather than assumed — brim vs satchel, tall vs short.
      const supplier = makeFigure(root, "supplier");
      supplier.g.position.set(-0.5, 0, 1.2);
      supplier.face(0.32);
      const factor = makeFigure(root, "factor");
      factor.g.position.set(1.5, 0, 1.2);
      factor.face(-0.28);
      figures = [supplier, factor];
    },

    update(t) {
      env.update(t);
      room.update(t);
      basins.update(t);
      for (const f of figures) f.update(t);
      void TERMS;
    },

    camera(): Shot {
      return { pos: [0.4, 4.4, 14.6], look: [0.2, 1.6, 0], fov: 46 };
    },
  };
}
