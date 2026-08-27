/* view.ts — draws the sim with Pixi. Reads sim state; never writes it.

   STAGE 1 view: instrumentation, not art. The sketch defers the visual design
   deliberately, and this is not it — it is the minimum needed to look at the
   physics and see whether it is doing what the tests say it is.

   Two things are drawn, and both are diagnostic:

     CELLS, tinted by which cluster they are in. The hue comes from the lowest
     cell index in the cluster rather than from the cluster's id, because ids are
     recomputed from scratch every tick and would strobe. Lowest-index is stable
     while a lump holds together and CHANGES WHEN IT SPLITS — so a fracture is
     visible as one half of a lump changing colour, which is the event this whole
     stage exists to produce.

     BONDS, tinted by how close they are to breaking. A bond carrying no load is
     dim; one at its limit is hot. You can watch strain gather in a growing lump
     and see where it is about to tear before it does.

   Nothing here calls app.render() — the loop does that once per frame, after
   every mounted scene has drawn. */

import { Container, Graphics } from 'pixi.js';
import { CFG } from './cfg.js';
import type { Sim } from './sim.js';

/** hsl → 0xRRGGBB, so we don't depend on how Pixi parses colour strings. */
function hslHex(h: number, s: number, l: number): number {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** Spread consecutive seeds around the wheel instead of into a gradient. */
const hueFor = (n: number) => (n * 137.508) % 360;

export function createView(parent: Container, sim: Sim) {
  const root = new Container();
  parent.addChild(root);

  const bonds = new Graphics();
  const cells = new Graphics();
  root.addChild(bonds, cells);

  let showBonds = true;

  return {
    root,
    setBondsVisible(on: boolean) { showBonds = on; if (!on) bonds.clear(); },
    /** Kept so the settings toggle in main has something to talk to. */
    setTrailVisible(on: boolean) { showBonds = on; if (!on) bonds.clear(); },

    render() {
      /* lowest cell index per cluster — the stable identity for colouring */
      const anchor = new Map<number, number>();
      for (let i = 0; i < sim.cells.length; i++) {
        const c = sim.cells[i]!;
        const cur = anchor.get(c.cluster);
        if (cur === undefined || i < cur) anchor.set(c.cluster, i);
      }

      bonds.clear();
      if (showBonds) {
        for (const b of sim.bonds) {
          if (!b.live) continue;
          const a = sim.cells[b.a]!;
          const c = sim.cells[b.b]!;
          const load = b.strength > 0 ? Math.min(1, b.tension / b.strength) : 0;
          bonds.moveTo(a.x, a.y);
          bonds.lineTo(c.x, c.y);
          bonds.stroke({
            width: 1.6 + load * 1.6,
            // slack bonds sit cool and dim; a bond at its limit goes hot
            color: hslHex(200 - load * 200, 55 + load * 45, 38 + load * 22),
            alpha: 0.35 + load * 0.65,
          });
        }
      }

      cells.clear();
      for (const c of sim.cells) {
        const hue = hueFor(anchor.get(c.cluster) ?? 0);
        const lone = sim.clusterSizes.length === sim.cells.length;
        cells.circle(c.x, c.y, c.r);
        // a cell that is nobody's partner is drawn flat and grey-ish, so the
        // difference between a soup of singles and a world of lumps is instant
        cells.fill({ color: lone ? 0x6a7480 : hslHex(hue, 46, 62), alpha: 0.95 });
        cells.circle(c.x, c.y, c.r);
        cells.stroke({ width: 1, color: 0x1b2027, alpha: 0.5 });
      }
    },

    destroy() {
      root.destroy({ children: true });
    },
  };
}

export type View = ReturnType<typeof createView>;

/** Re-exported so main can size the camera to the world without importing cfg. */
export const worldExtent = () => CFG.seedSpread * 6;
