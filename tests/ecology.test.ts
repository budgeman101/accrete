/* ecology.test.ts — the claims that need a settled world to be true or false.

   Slow on purpose, and separate for a reason worth writing down: every one of
   these compares two populations, and getting that wrong cost this project more
   than anything else. Three rules, learned the hard way:

   1. MEASURE AT EQUILIBRIUM. "Does stickiness pay" came out YES at 14,000 ticks
      and NO at 9,000, because neither was settled. Most of that transient was
      COLONISATION — a spreading front, not an ecology — which is why the world
      is seeded everywhere and settles in a few thousand ticks.

   2. AVERAGE, AND USE TWO SEEDS. A single tick is ±20% noise, larger than most
      of the differences being asked about. A difference that cannot survive a
      second world was never a difference.

   3. COMPETE, DO NOT COMPARE. Two worlds of different composition tell you about
      GROUP effects. Selection acts within one world. A trait can raise the
      carrying capacity of a population that has it while losing to its own
      neighbours, and mistaking the first for the second is what sent this
      project chasing three mechanisms it did not need.

   Run: npm test        (everything)
        npm run test:quick   (just the fast mechanism tests) */

import { afterEach, describe, expect, it } from 'vitest';
import { createSim, stats, tick } from '../src/game/sim.js';
import { CFG } from '../src/game/cfg.js';

const BASE = { ...CFG };
afterEach(() => Object.assign(CFG, BASE));

const SEEDS = ['brimtoveharn', 'kelpwrackfen'];

/** Settle, then average over a window, across both seeds. */
function equilibrium(over: Partial<typeof CFG>, settle = 5000, window = 5000, every = 200) {
  let pop = 0;
  let field = 0;
  let n = 0;
  for (const seed of SEEDS) {
    Object.assign(CFG, BASE, over);
    const sim = createSim(seed);
    for (let i = 0; i < settle; i++) tick(sim, 1 / 60);
    for (let i = 0; i < window; i++) {
      tick(sim, 1 / 60);
      if (i % every) continue;
      const s = stats(sim);
      pop += s.cells;
      field += s.fieldMean;
      n++;
    }
  }
  return { pop: pop / n, field: field / n };
}

/** Two lineages in ONE world, mutation off. The instrument that matters. */
function compete(over: Partial<typeof CFG> = {}, sticky = 0.7, ticks = 20000) {
  let sum = 0;
  for (const seed of SEEDS) {
    Object.assign(CFG, BASE, { mutStickiness: 0, mutRatio: 0 }, over);
    const sim = createSim(seed);
    sim.cells.forEach((c, i) => { c.genes.stickiness = i % 2 ? sticky : 0; });
    for (let i = 0; i < ticks; i++) {
      tick(sim, 1 / 60);
      if (!sim.cells.length) break;
    }
    sum += sim.cells.length
      ? sim.cells.filter((c) => c.genes.stickiness > sticky / 2).length / sim.cells.length
      : 0;
  }
  return sum / SEEDS.length;
}

describe('what this world actually does with stickiness', () => {
  it('records where sticking currently stands, in competition', () => {
    /* NOT a target. The claim this project makes is that the world has two
       dimensions the others lack — not that multicellularity appears in it.
       Whether sticking wins, loses or sits neutral is an OBSERVATION, and this
       test exists to notice if it ever changes rather than to demand a value.

       Everything built to force it upward — a current, drag shelter,
       surface-to-volume upkeep, chemotaxis, sharing along bonds — was measured
       and cut. Treating a legitimate null as a bug is what produced them. */
    const share = compete();
    expect(share).toBeGreaterThanOrEqual(0);
    expect(share).toBeLessThanOrEqual(1);
    // the standing measurement, so a silent shift shows up as a failure
    expect(share).toBeLessThan(0.5);
  }, 900_000);

  it('the world survives either way — neither lineage drives it extinct', () => {
    expect(equilibrium({ stickiness: 0 }).pop).toBeGreaterThan(20);
    expect(equilibrium({ stickiness: 1 }).pop).toBeGreaterThan(20);
  }, 600_000);
});

describe('structure over the long run', () => {
  it('patchiness is SUSTAINED, not a colonisation transient', () => {
    /* The figure of ~30 patches once recorded here was itself a colonisation
       artefact. At equilibrium it is far smaller — the point is that it does not
       collapse to one, which is what proportional-to-shortfall regrowth gave. */
    Object.assign(CFG, BASE);
    const sim = createSim('brimtoveharn');
    for (let i = 0; i < 6000; i++) tick(sim, 1 / 60);
    const early = stats(sim).patchCount;
    for (let i = 0; i < 14000; i++) tick(sim, 1 / 60);
    const late = stats(sim).patchCount;
    expect(early).toBeGreaterThan(1);
    expect(late).toBeGreaterThan(1);
  }, 600_000);
});
