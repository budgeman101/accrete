/* view.ts — draws the sim with Pixi. Reads sim state; never writes it.

   THE ONE GOAL THIS PROJECT ADMITS TO: can you watch it and tell what happened?

   That comes from the complaint the whole thing started with, about The Life
   Engine: *"it's just abstract noise — none of it represents anything concrete,
   some pixels move while others don't even though they are the same shape and
   colour."* Every decision below answers a clause of that sentence.

     "the same shape and colour" — CELLS ARE COLOURED BY THEIR GENOME, not by
     which cluster they happen to be in. A cell that behaves differently now
     LOOKS different, which was the whole complaint. Cluster membership does not
     need colour: the bonds already draw it. And colouring by heredity means
     related cells share a hue, so lineages are visible as drifts of colour
     without anything tracking them.

     "some pixels move while others don't" — a cell's brightness is how fed it
     is, so a starving cell visibly fades before it dies rather than blinking out
     of a uniform crowd.

     things that happen at all — FRACTURE AND DEATH ARE OVER IN AN INSTANT and
     leave nothing behind, so the two events that matter most were the two you
     could not see. They now leave a brief mark.

   The ground is the world's memory (rule 1): spoiled ground goes dark and comes
   back at rate R long after whatever ate it has died.

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

/** A fading mark left by something that happened. */
interface Mark { x: number; y: number; kind: 'fracture' | 'death'; age: number }

export function createView(parent: Container, sim: Sim) {
  const root = new Container();
  parent.addChild(root);

  const ground = new Graphics();
  const bonds = new Graphics();
  const cells = new Graphics();
  const marks = new Graphics();
  root.addChild(ground, bonds, cells, marks);

  let showBonds = true;
  /* The ground is sampled finer than the field and read BILINEARLY, so what you
     see is the smooth quantity a cell draws from rather than the storage grid.
     Nearest-neighbour at field resolution reads as tiles — the simulation's
     bookkeeping showing through the world. Redrawn every few frames: the field
     moves slowly and this is the most expensive thing here. */
  const GROUND_SUB = 3; // 10-unit blocks: the same size as a cell, not larger
  const GROUND_EVERY = 6;
  let groundAge = GROUND_EVERY;

  const live: Mark[] = [];
  const MARK_LIFE = 26;

  /* One individual, followed. The complaint that started this project included
     "noise is what five thousand dots look like" — the answer to which is being
     able to pick one out and keep hold of it. Keyed on the stable id, because
     array indices shift under death and compaction. */
  let selected: number | null = null;

  return {
    root,
    setBondsVisible(on: boolean) { showBonds = on; if (!on) bonds.clear(); },
    select(id: number | null) { selected = id; },
    /** Nearest cell to a world point, within a couple of cell widths, or null. */
    pick(wx: number, wy: number): number | null {
      let best: number | null = null;
      let bestD = (CFG.cellRadius * 2.5) ** 2;
      for (const c of sim.cells) {
        const d = (c.x - wx) ** 2 + (c.y - wy) ** 2;
        if (d < bestD) { bestD = d; best = c.id; }
      }
      return best;
    },
    /** Kept so the settings toggle in main has something to talk to. */
    setTrailVisible(on: boolean) { showBonds = on; if (!on) bonds.clear(); },

    render() {
      /* ── the world's memory ── */
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
            ground.rect(origin + gx * fc, origin + gy * fc, fc + 0.5, fc + 0.5);
            ground.fill({ color: hslHex(96 - v * 8, 12 + v * 26, 7 + v * 15) });
          }
        }
      }

      /* ── bonds: membership, and how close each is to tearing ── */
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
            width: 1.8 + load * 2,
            color: hslHex(196 - load * 196, 40 + load * 55, 46 + load * 22),
            alpha: 0.45 + load * 0.55,
          });
        }
      }

      /* ── cells: the genome on the outside ── */
      cells.clear();
      for (const c of sim.cells) {
        /* Hue IS the gene the whole project is a question about. Loose cells sit
           cool and blue, sticky ones warm and orange, and everything between is
           between — so the population's genetics are legible at a glance and a
           drift in the gene is a drift in the colour of the world. */
        const stick = Math.max(0, Math.min(1, c.genes.stickiness));
        /* 190 -> 335: cyan through blue and violet to pink. Deliberately a band
           the GROUND never occupies — the world is green, and an earlier version
           mapped stickiness across a range whose middle was also green, so cells
           and world were the same colour and neither could be read. The mapping
           is absolute, not stretched to the population's current range, so a
           drift in the gene is visible as a drift in colour over time rather
           than being normalised away. */
        const hue = 190 + stick * 145;
        // brightness is condition: a starving cell fades before it goes
        const fed = Math.max(0, Math.min(1, c.reserve / CFG.reserveMax));
        cells.circle(c.x, c.y, c.r);
        cells.fill({ color: hslHex(hue, 48 + stick * 30, 34 + fed * 34), alpha: 0.97 });
        cells.circle(c.x, c.y, c.r);
        cells.stroke({ width: 1, color: 0x0d1116, alpha: 0.6 });
      }

      /* ── the one being followed, and everything bonded to it ── */
      if (selected !== null) {
        const me = sim.cells.find((c) => c.id === selected);
        if (me) {
          for (const c of sim.cells) {
            if (c.cluster !== me.cluster || c === me) continue;
            cells.circle(c.x, c.y, c.r + 2.5);
            cells.stroke({ width: 1.4, color: 0xffe9b8, alpha: 0.5 });
          }
          cells.circle(me.x, me.y, me.r + 4.5);
          cells.stroke({ width: 2.2, color: 0xffe9b8, alpha: 0.95 });
        }
      }

      /* ── what just happened ── */
      for (const e of sim.events) live.push({ x: e.x, y: e.y, kind: e.kind, age: 0 });
      marks.clear();
      for (let i = live.length - 1; i >= 0; i--) {
        const m = live[i]!;
        m.age++;
        if (m.age > MARK_LIFE) { live.splice(i, 1); continue; }
        const t = m.age / MARK_LIFE;
        if (m.kind === 'fracture') {
          // a bond let go: a ring opening outward from where it parted
          marks.circle(m.x, m.y, CFG.cellRadius * (0.5 + t * 2.4));
          marks.stroke({ width: 2 * (1 - t), color: 0xffd9a0, alpha: 0.85 * (1 - t) });
        } else {
          // a cell starved: a small collapsing cross where it was
          const r = CFG.cellRadius * (1 - t) * 0.9;
          marks.moveTo(m.x - r, m.y - r); marks.lineTo(m.x + r, m.y + r);
          marks.moveTo(m.x + r, m.y - r); marks.lineTo(m.x - r, m.y + r);
          marks.stroke({ width: 1.6, color: 0x9aa6b2, alpha: 0.5 * (1 - t) });
        }
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
