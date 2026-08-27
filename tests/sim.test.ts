/* sim.test.ts — stage 1: does grow-and-break work, and is the size emergent?

   These are not "does the code run" tests. Each one is a claim from
   accrete-sketch.md that the physics either honours or doesn't. The load-bearing
   ones are the last two: cluster size must come out of the packing, which means
   it has to RESPOND to bond strength and it has to plateau on its own.

   Run: npm test */

import { afterEach, describe, expect, it } from 'vitest';
import { createSim, resetSim, stats, tick, type Sim } from '../src/game/sim.js';
import { CFG } from '../src/game/cfg.js';

/* A smaller world than the real one: these tests need thousands of ticks, and
   the cap is a tab-safety limit rather than anything biological. Set before BASE
   is captured so afterEach restores to the test cap, not the production one. */
Object.assign(CFG, { maxCells: 500 });
const BASE = { ...CFG };
afterEach(() => Object.assign(CFG, BASE));

const run = (seed: string, ticks: number, dt = 1 / 60): Sim => {
  const sim = createSim(seed);
  for (let i = 0; i < ticks; i++) tick(sim, dt);
  return sim;
};

describe('stability', () => {
  it('never produces a non-finite position', () => {
    const sim = run('brimtoveharn', 1500);
    for (const c of sim.cells) {
      expect(Number.isFinite(c.x)).toBe(true);
      expect(Number.isFinite(c.y)).toBe(true);
    }
  });

  it('does not fling cells to infinity — the whole population stays local', () => {
    const sim = run('brimtoveharn', 1500);
    const far = Math.max(...sim.cells.map((c) => Math.hypot(c.x, c.y)));
    // a packed disc of n cells has radius ~ r*sqrt(n); allow generous slack
    const plausible = CFG.cellRadius * Math.sqrt(sim.cells.length) * 6 + CFG.seedSpread;
    expect(far).toBeLessThan(plausible);
  });

  it('replays identically from the same seed', () => {
    const a = stats(run('brimtoveharn', 900));
    const b = stats(run('brimtoveharn', 900));
    expect(b).toEqual(a);
  });

  it('diverges on a different seed', () => {
    const a = stats(run('brimtoveharn', 900));
    const b = stats(run('kelpwrackfen', 900));
    expect(b).not.toEqual(a);
  });
});

describe('the unicellular control', () => {
  it('with stickiness 0 every cell is its own cluster, forever', () => {
    CFG.stickiness = 0;
    const sim = run('brimtoveharn', 1200);
    expect(sim.cells.length).toBeGreaterThan(CFG.seedCount);
    expect(sim.clusterSizes.every((s) => s === 1)).toBe(true);
    expect(sim.clusterSizes.length).toBe(sim.cells.length);
  });

  it('with stickiness 0 nothing can fracture, because nothing is bonded', () => {
    CFG.stickiness = 0;
    const sim = run('brimtoveharn', 1200);
    expect(sim.bonds.length).toBe(0);
    expect(sim.totalFractures).toBe(0);
  });
});

describe('clusters form and break', () => {
  it('with stickiness on, cells accumulate into multi-cell clusters', () => {
    const sim = run('brimtoveharn', 900);
    expect(stats(sim).largest).toBeGreaterThan(1);
  });

  it('bonds snap — crowding tears the thing apart with no split rule anywhere', () => {
    const sim = run('brimtoveharn', 2000);
    expect(sim.totalFractures).toBeGreaterThan(0);
  });

  it('fracture makes MORE clusters than were seeded — that is reproduction', () => {
    const sim = run('brimtoveharn', 2000);
    expect(sim.clusterSizes.length).toBeGreaterThan(CFG.seedCount);
  });
});

describe('size is emergent, not authored', () => {
  it('the largest cluster plateaus far below the cell count', () => {
    const sim = run('brimtoveharn', 2500);
    const s = stats(sim);
    // if size were unbounded, everything would be one lump
    expect(s.largest).toBeLessThan(s.cells * 0.6);
    expect(s.cells).toBeGreaterThan(40);
  });

  it('stronger bonds hold bigger clusters — size responds to the physics', () => {
    CFG.stickiness = 0.35;
    const weak = stats(run('brimtoveharn', 2500)).largest;
    Object.assign(CFG, BASE);
    CFG.stickiness = 1;
    const strong = stats(run('brimtoveharn', 2500)).largest;
    expect(strong).toBeGreaterThan(weak);
  });
});

describe('reset', () => {
  it('returns to a known state so a run can be driven from tick zero', () => {
    const sim = run('brimtoveharn', 800);
    resetSim(sim, 'brimtoveharn');
    expect(sim.tick).toBe(0);
    expect(sim.cells.length).toBe(CFG.seedCount);
    expect(sim.bonds.length).toBe(0);
    expect(sim.totalFractures).toBe(0);
  });
});
