/* sim.test.ts — the rules, tested with no browser at all.

   These are not "does the code run" tests. Each one is a claim from
   accrete-sketch.md that the world either honours or doesn't, and several of
   them are claims that NOTHING WAS AUTHORED — that a thing the design predicts
   appears without any rule producing it directly.

   Run: npm test */

import { afterEach, describe, expect, it } from 'vitest';
import { createSim, resetSim, stats, substrateAt, tick, type Sim } from '../src/game/sim.js';
import { makeRng } from '../src/kit/rng.js';
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

  it('and it is real STRUCTURE, not one big bare region', () => {
    /* sd measures contrast and cannot tell a patchwork from a world stripped
       down one side. This is the test that caught that, and the one that caught
       proportional-to-shortfall regrowth forbidding deserts entirely. */
    const s = stats(run('brimtoveharn', 9000));
    expect(s.patchCount).toBeGreaterThan(2);
    expect(s.meanPatchSize).toBeLessThan(CFG.fieldSize ** 2 * 0.25);
  });

  it('the ablation makes the world uniform while keeping it finite', () => {
    /* Dimension 1 switched off. The first version of this REFILLED the field and
       so removed scarcity along with the structure — the resource became infinite
       and the population ran to the array cap. Well-mixing keeps the total and
       destroys only the WHERE, which is what the derivation specifies. */
    CFG.wellMixedWorld = true;
    const sim = createSim('brimtoveharn');
    const before = stats(sim).fieldMean;
    for (let i = 0; i < 400; i++) tick(sim, 1 / 60);
    const s = stats(sim);
    expect(s.fieldSd).toBeCloseTo(0, 4);        // uniform everywhere
    expect(s.patchCount).toBeLessThan(2);       // and therefore no patches
    expect(s.fieldMean).toBeLessThan(before);   // but still finite: it was drawn down
  });

  it('bare ground cannot regrow from nothing — only its neighbours seed it', () => {
    CFG.diffuse = 0;
    const sim = createSim('brimtoveharn');
    sim.cells.length = 0;
    sim.bonds.length = 0;
    sim.field.fill(0);
    for (let i = 0; i < 2000; i++) tick(sim, 1 / 60);
    expect(stats(sim).fieldMean).toBe(0);
  });

  it('cells spoil the ground they stand on', () => {
    const sim = run('brimtoveharn', 4500);
    const under = sim.cells.map((c) => substrateAt(sim, c.x, c.y));
    const mean = under.reduce((a, b) => a + b, 0) / under.length;
    expect(mean).toBeLessThan(stats(sim).fieldMean);
  });

  it('a patch both falls and recovers — local boom and bust, not a one-way strip', () => {
    const sim = createSim('brimtoveharn');
    const watch = new Array(CFG.fieldSize ** 2).fill(0).map((_, i) => i).filter((_, i) => i % 37 === 0);
    const lo = new Map<number, number>();
    let anyRecovered = false;
    for (let i = 0; i < 14000; i++) {
      tick(sim, 1 / 60);
      if (i % 25) continue;
      for (const idx of watch) {
        const v = sim.field[idx]!;
        const l = Math.min(lo.get(idx) ?? v, v);
        lo.set(idx, l);
        // fell a long way and then climbed a long way back out of it
        if (l < CFG.fieldMax * 0.25 && v > l + CFG.fieldMax * 0.35) anyRecovered = true;
      }
    }
    expect(anyRecovered).toBe(true);
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
    // mutation off: CFG only sets where a world STARTS, and this isolates rule 2
    CFG.mutStickiness = 0;
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

describe('the instrument itself', () => {
  const blankSim = () => {
    const sim = createSim('brimtoveharn');
    sim.cells.length = 0;
    sim.bonds.length = 0;
    return sim;
  };
  const n = () => CFG.fieldSize;

  it('patch count tells ONE stripped half from MANY clearings; sd cannot', () => {
    const N = n();

    const halved = blankSim();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) halved.field[y * N + x] = x < N / 2 ? 0 : CFG.fieldMax;

    const speckled = blankSim();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const blockish = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0;
      speckled.field[y * N + x] = blockish ? 0 : CFG.fieldMax;
    }

    const a = stats(halved);
    const b = stats(speckled);

    // sd is blind to the difference: both are half bare, half full
    expect(Math.abs(a.fieldSd - b.fieldSd)).toBeLessThan(CFG.fieldMax * 0.05);
    // patch count is not
    expect(a.patchCount).toBe(1);
    expect(b.patchCount).toBeGreaterThan(20);
  });

  it('REGROWTH MUST NOT BE FASTEST AT ZERO — the shape that forbade deserts', () => {
    /* Growing back by a fraction of the shortfall peaks at empty, so nothing can
       ever stay ruined and the world converges on one uniformly cropped flux.
       This test fails the moment anyone writes that model again. */
    CFG.diffuse = 0;
    const sim = blankSim();
    const levels = [0, 0.25, 0.5, 0.75, 1].map((f) => f * CFG.fieldMax);
    for (let i = 0; i < levels.length; i++) sim.field[i] = levels[i]!;
    const before = levels.slice();
    tick(sim, 1 / 60);
    const growth = levels.map((_, i) => sim.field[i]! - before[i]!);

    expect(growth[0]).toBe(0);                              // bare ground is dead ground
    expect(growth[2]).toBeGreaterThan(growth[1]!);          // fastest in the middle
    expect(growth[2]).toBeGreaterThan(growth[3]!);
    expect(growth[4]).toBeCloseTo(0, 6);                    // and nothing left to gain when full
  });
});

describe('genes are carried by the cell, not read from config', () => {
  it('a daughter inherits its parent, with error', () => {
    const sim = run('brimtoveharn', 4000);
    expect(sim.cells.length).toBeGreaterThan(20);
    const spread = (pick: (c: (typeof sim.cells)[number]) => number) => {
      const v = sim.cells.map(pick);
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    };
    // variation exists at all (mutation happened) and has not exploded
    expect(spread((c) => c.genes.stickiness)).toBeGreaterThan(0.005);
    expect(spread((c) => c.genes.bondStrength)).toBeGreaterThan(0);
  });

  it('a bond takes its strength from the DAUGHTER genes, not from CFG', () => {
    const sim = run('brimtoveharn', 4000);
    const live = sim.bonds.filter((b) => b.live);
    expect(live.length).toBeGreaterThan(5);
    const fromCfg = CFG.stickiness * CFG.bondStrengthMax;
    // at least some bond differs from what the config alone would have produced
    expect(live.some((b) => Math.abs(b.strength - fromCfg) > 1e-6)).toBe(true);
  });

  it('a world seeded unicellular can still discover adhesion', () => {
    /* Multiplicative mutation on a proportion can never leave zero, so a world
       seeded at stickiness 0 could never become multicellular however long it
       ran — the model would forbid the phenomenon. Stickiness mutates additively
       for exactly this reason. */
    CFG.stickiness = 0;
    const sim = run('brimtoveharn', 3000);
    expect(sim.cells.some((c) => c.genes.stickiness > 0)).toBe(true);
  });
});

describe('the instrument, again: a bounded gene drifts off its boundary', () => {
  it('RISING FROM ZERO IS NOT EVIDENCE OF SELECTION', () => {
    /* With no world and no selection at all, a gene seeded at 0 and mutated
       symmetrically still climbs: negative steps clamp at the boundary and
       positive ones accumulate. A ratchet, not a preference.

       This caught a real result: stickiness rose from 0 in every condition,
       INCLUDING both controls, and none of it meant anything. Experiments on a
       bounded gene have to be seeded mid-range, or compared between conditions —
       never read as an absolute. */
    const rng = makeRng('driftcheck');
    let pop = new Array(400).fill(0);
    for (let gen = 0; gen < 200; gen++) {
      pop = pop.map((v) => Math.max(0, Math.min(1, v + rng.gauss(0, CFG.mutStickiness))));
    }
    const mean = pop.reduce((a, b) => a + b, 0) / pop.length;
    expect(mean).toBeGreaterThan(0.1); // climbed a long way, with nothing selecting for it
  });

  it('and seeded mid-range it does not drift in either direction', () => {
    const rng = makeRng('driftcheck');
    let pop = new Array(400).fill(0.5);
    for (let gen = 0; gen < 200; gen++) {
      pop = pop.map((v) => Math.max(0, Math.min(1, v + rng.gauss(0, CFG.mutStickiness))));
    }
    const mean = pop.reduce((a, b) => a + b, 0) / pop.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.08);
  });
});

describe('what happened is recorded, so it can be shown', () => {
  it('fractures and deaths leave an event with a place, and it lasts one tick', () => {
    /* Both are over in the instant they occur and leave nothing behind to draw,
       so without this the two events that matter most are the two you cannot
       see. Instrumentation: nothing in the sim ever reads it. */
    const sim = createSim('brimtoveharn');
    let sawFracture = false;
    let sawDeath = false;
    let maxPerTick = 0;
    for (let i = 0; i < 6000; i++) {
      tick(sim, 1 / 60);
      maxPerTick = Math.max(maxPerTick, sim.events.length);
      for (const e of sim.events) {
        expect(Number.isFinite(e.x)).toBe(true);
        if (e.kind === 'fracture') sawFracture = true;
        if (e.kind === 'death') sawDeath = true;
      }
      // exactly this tick's events, never an accumulating list
      expect(sim.events.length).toBe(sim.fracturesThisTick + sim.deathsThisTick);
    }
    expect(sawFracture).toBe(true);
    expect(sawDeath).toBe(true);
    expect(maxPerTick).toBeGreaterThan(0);
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
