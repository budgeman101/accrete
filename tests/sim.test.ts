/* sim.test.ts — the rules, tested with no browser at all.

   These are not "does the code run" tests. Each one is a claim from
   accrete-sketch.md that the world either honours or doesn't, and several of
   them are claims that NOTHING WAS AUTHORED — that a thing the design predicts
   appears without any rule producing it directly.

   Run: npm test */

import { afterEach, describe, expect, it } from 'vitest';
import { createSim, resetSim, stats, substrateAt, tick, type Sim } from '../src/game/sim.js';
import { CFG } from '../src/game/cfg.js';

/* A smaller world than the real one: these tests need thousands of ticks. Set
   before BASE is captured so afterEach restores to the test cap. */
Object.assign(CFG, { maxCells: 1600 });
const BASE = { ...CFG };
afterEach(() => Object.assign(CFG, BASE));

const run = (seed: string, ticks: number, dt = 1 / 60): Sim => {
  const sim = createSim(seed);
  for (let i = 0; i < ticks; i++) tick(sim, dt);
  return sim;
};

describe('stability', () => {
  it('never produces a non-finite position', () => {
    const sim = run('brimtoveharn', 3000);
    for (const c of sim.cells) {
      expect(Number.isFinite(c.x)).toBe(true);
      expect(Number.isFinite(c.y)).toBe(true);
    }
  });

  it('replays identically from the same seed', () => {
    expect(stats(run('brimtoveharn', 2000))).toEqual(stats(run('brimtoveharn', 2000)));
  });

  it('diverges on a different seed', () => {
    expect(stats(run('kelpwrackfen', 2000))).not.toEqual(stats(run('brimtoveharn', 2000)));
  });

  it('keeps bond indices valid across death and compaction', () => {
    const sim = run('brimtoveharn', 4000);
    expect(sim.totalDeaths).toBeGreaterThan(0); // compaction actually ran
    for (const b of sim.bonds) {
      expect(sim.cells[b.a]).toBeDefined();
      expect(sim.cells[b.b]).toBeDefined();
    }
  });
});

/* ── rule 3 ─────────────────────────────────────────────────────────────── */

describe('rule 3 — existing costs, and the cost comes out of the world', () => {
  it('cells die of neglect, and keep dying: there is real turnover', () => {
    const a = run('brimtoveharn', 3000);
    const b = run('brimtoveharn', 4500);
    expect(a.totalDeaths).toBeGreaterThan(0);
    expect(b.totalDeaths).toBeGreaterThan(a.totalDeaths);
  });

  it('with nothing to draw, everything starves inside its reserve', () => {
    CFG.drawRate = 0;
    const ticksToStarve = Math.ceil((CFG.reserveMax * CFG.reserveAtBirth) / CFG.upkeep);
    const sim = run('brimtoveharn', ticksToStarve + 5);
    expect(sim.cells.length).toBe(0);
  });

  it('the population settles at a carrying capacity, not at the cell cap', () => {
    const sim = run('brimtoveharn', 6000);
    expect(sim.cells.length).toBeGreaterThan(20);
    expect(sim.cells.length).toBeLessThan(CFG.maxCells * 0.8);
  });

  it('growth is not scheduled — a richer world breeds faster', () => {
    const lean = run('brimtoveharn', 2500).cells.length;
    Object.assign(CFG, BASE);
    CFG.fieldMax = BASE.fieldMax * 3;
    const rich = run('brimtoveharn', 2500).cells.length;
    expect(rich).toBeGreaterThan(lean);
  });
});

/* ── rule 1 ─────────────────────────────────────────────────────────────── */

describe('rule 1 — the world keeps what agents do to it', () => {
  it('the field starts perfectly uniform', () => {
    expect(stats(createSim('brimtoveharn')).fieldSd).toBe(0);
  });

  it('PATCHINESS IS MADE BY THE CELLS — nothing supplied it', () => {
    const sim = run('brimtoveharn', 4500);
    expect(stats(sim).fieldSd).toBeGreaterThan(1);
  });

  it('cells spoil the ground they stand on', () => {
    const sim = run('brimtoveharn', 4500);
    const under = sim.cells.map((c) => substrateAt(sim, c.x, c.y));
    const mean = under.reduce((a, b) => a + b, 0) / under.length;
    expect(mean).toBeLessThan(stats(sim).fieldMean);
  });

  it('the world FORGETS SLOWLY — a spoiled field does not spring back', () => {
    const sim = run('brimtoveharn', 4500);
    const spoiled = stats(sim).fieldMean;
    sim.cells.length = 0; // remove every cell; nothing is drawing any more
    sim.bonds.length = 0;
    for (let i = 0; i < 200; i++) tick(sim, 1 / 60);
    const after = stats(sim).fieldMean;
    expect(after).toBeGreaterThan(spoiled); // it does recover
    expect(after).toBeLessThan(CFG.fieldMax * 0.999); // but nowhere near instantly
  });
});

/* ── rule 2 ─────────────────────────────────────────────────────────────── */

describe('rule 2 — separation can fail, and crowding tears the result apart', () => {
  it('with stickiness 0 every cell is its own cluster, and nothing can fracture', () => {
    CFG.stickiness = 0;
    const sim = run('brimtoveharn', 4000);
    expect(sim.cells.length).toBeGreaterThan(0);
    expect(sim.clusterSizes.every((s) => s === 1)).toBe(true);
    expect(sim.bonds.length).toBe(0);
    expect(sim.totalFractures).toBe(0);
  });

  it('with stickiness on, cells accumulate into multi-cell clusters', () => {
    expect(stats(run('brimtoveharn', 4000)).largest).toBeGreaterThan(1);
  });

  it('bonds snap — crowding tears lumps apart with no split rule anywhere', () => {
    expect(run('brimtoveharn', 4500).totalFractures).toBeGreaterThan(0);
  });

  it('stronger bonds hold bigger clusters — size responds to the physics', () => {
    CFG.stickiness = 0.3;
    const weak = stats(run('brimtoveharn', 4500)).meanClusterSize;
    Object.assign(CFG, BASE);
    CFG.stickiness = 1;
    const strong = stats(run('brimtoveharn', 4500)).meanClusterSize;
    expect(strong).toBeGreaterThan(weak);
  });
});

describe('reset', () => {
  it('returns to a known state so a run can be driven from tick zero', () => {
    const sim = run('brimtoveharn', 2000);
    resetSim(sim, 'brimtoveharn');
    expect(sim.tick).toBe(0);
    expect(sim.cells.length).toBe(CFG.seedCount);
    expect(sim.bonds.length).toBe(0);
    expect(sim.totalDeaths).toBe(0);
    expect(stats(sim).fieldSd).toBe(0);
  });
});
