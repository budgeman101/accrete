/* view.ts — draws the sim with Pixi. Reads sim state; never writes it.

   Instrumentation, not art. The sketch defers the visual design deliberately and
   this is not it. It is the minimum needed to look at the rules and see whether
   they are doing what the tests say.

   Three layers, each diagnostic:

     THE FIELD (rule 1). The world's memory, drawn as it is. Ground the cells
     have spoiled goes dark and stays dark, and you can watch it come back at
     rate R long after whatever ate it has died. Stage 1 rendered as confetti
     precisely because this layer did not exist — there was nowhere to BE.

     BONDS, tinted by how close they are to breaking. Slack is dim and cool; a
     bond at its limit is hot. Strain gathering in a growing lump is visible
     before it tears.

     CELLS, tinted by which cluster they are in, and faded by how near they are
     to starving. The hue comes from the LOWEST CELL INDEX in the cluster rather
     than the cluster's id, because ids are recomputed every tick and would
     strobe. Lowest-index is stable while a lump holds together and changes when
     it splits — so a fracture reads as half a lump changing colour.

   Nothing here calls app.render() — the loop does that once per frame. */

import { Container, Graphics } from 'pixi.js';
import { CFG } from './cfg.js';
import { substrateAt, type Sim } from './sim.js';

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

  const ground = new Graphics();
  const bonds = new Graphics();
  const cells = new Graphics();
  root.addChild(ground, bonds, cells);

  let showBonds = true;
  /* The ground is sampled at a finer grid than the field and read BILINEARLY, so
     what you see is the same smooth quantity a cell draws from rather than the
     storage grid. Drawn nearest-neighbour at field resolution it reads as tiles,
     which is the simulation's bookkeeping showing through the world.
     Redrawn every few frames only: at regen 0.0016 the field moves slowly and
     redrawing thousands of rects every frame is the most expensive thing here. */
  const GROUND_SUB = 2;
  const GROUND_EVERY = 6;
  let groundAge = GROUND_EVERY;

  return {
    root,
    setBondsVisible(on: boolean) { showBonds = on; if (!on) bonds.clear(); },
    /** Kept so the settings toggle in main has something to talk to. */
    setTrailVisible(on: boolean) { showBonds = on; if (!on) bonds.clear(); },

    render() {
      /* ── the field ── */
      if (++groundAge >= GROUND_EVERY) {
        groundAge = 0;
        const n = CFG.fieldSize * GROUND_SUB;
        const fc = CFG.fieldCell / GROUND_SUB;
        const origin = -(CFG.fieldSize * CFG.fieldCell) / 2;
        ground.clear();
        for (let gy = 0; gy < n; gy++) {
          const wy = origin + (gy + 0.5) * fc;
          for (let gx = 0; gx < n; gx++) {
            const wx = origin + (gx + 0.5) * fc;
            const v = Math.max(0, Math.min(1, substrateAt(sim, wx, wy) / CFG.fieldMax));
            // full ground is a dim green; spoiled ground goes toward bare dark
            ground.rect(origin + gx * fc, origin + gy * fc, fc + 0.5, fc + 0.5);
            ground.fill({ color: hslHex(96 - v * 8, 12 + v * 26, 7 + v * 15) });
          }
        }
      }

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
            color: hslHex(200 - load * 200, 55 + load * 45, 40 + load * 24),
            alpha: 0.4 + load * 0.6,
          });
        }
      }

      cells.clear();
      for (const c of sim.cells) {
        const hue = hueFor(anchor.get(c.cluster) ?? 0);
        const alone = sim.clusterSizeOf[c.cluster] === 1;
        // a starving cell fades toward the ground; a full one is bright
        const fed = Math.max(0, Math.min(1, c.reserve / CFG.reserveMax));
        cells.circle(c.x, c.y, c.r);
        cells.fill({
          color: alone ? hslHex(210, 8, 34 + fed * 26) : hslHex(hue, 30 + fed * 34, 34 + fed * 32),
          alpha: 0.96,
        });
        cells.circle(c.x, c.y, c.r);
        cells.stroke({ width: 1, color: 0x10141a, alpha: 0.55 });
      }
    },

    destroy() {
      root.destroy({ children: true });
    },
  };
}

export type View = ReturnType<typeof createView>;

/** The world's half-extent, so the camera can frame it without importing cfg. */
export const worldExtent = () => (CFG.fieldSize * CFG.fieldCell) / 2;
