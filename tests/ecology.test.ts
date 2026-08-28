/* ecology.test.ts — the claims that need a settled world to be true or false.

   These are SLOW on purpose and they live apart from sim.test.ts for a reason
   worth writing down: every one of them compares two populations, and getting
   that wrong is what cost this project the most.

   Two rules, learned the hard way:

   1. MEASURE AT EQUILIBRIUM. "Does stickiness pay" came out YES at 14,000 ticks
      and NO at 9,000, because neither was settled. Most of that transient was
      COLONISATION — a spreading front, not an ecology — which is why the world
      is now seeded everywhere and settles in a few thousand ticks instead of
      forty thousand.

   2. AVERAGE, AND USE TWO SEEDS. A single tick is ±20% noise, which is larger
      than most of the differences being asked about. A difference that cannot
      survive a second world was never a difference.

   Run: npm test        (everything)
        npm run test:quick   (just the fast mechanism tests) */

import { afterEach, describe, expect, it } from 'vitest';
import { createSim, stats, substrateAt, tick } from '../src/game/sim.js';
import { CFG } from '../src/game/cfg.js';

const BASE = { ...CFG };
afterEach(() => Object.assign(CFG, BASE));

const SEEDS = ['brimtoveharn', 'kelpwrackfen'];

/** Settle, then average over a window. Returns means across both seeds. */
function equilibrium(over: Partial<typeof CFG>, settle = 5000, window = 5000, every = 200) {
  let pop = 0;
  let under = 0;
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
      under += sim.cells.length
        ? sim.cells.reduce((a, c) => a + substrateAt(sim, c.x, c.y), 0) / sim.cells.length
        : 0;
      n++;
    }
  }
  return { pop: pop / n, field: field / n, under: under / n };
}

/** Two lineages in ONE world, mutation off. This is the instrument that matters:
    what a gene does in competition, not what a world of them looks like. */
function compete(over: Partial<typeof CFG>, sticky = 0.7, ticks = 20000) {
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

describe('what makes composition pay — and what it does not', () => {
  it('A STICKY WORLD IS BIGGER, WHICH IS NOT THE SAME AS STICKINESS PAYING', () => {
    /* THE CENTRAL FINDING SO FAR, and the error it corrects is mine.

       Between worlds, an all-sticky population supports about 5% more cells than
       an all-loose one, and that was taken as rule 4 doing its job. But selection
       acts WITHIN a world. Put both lineages in one world and loose wins at every
       setting tested — 36% sticky with no current, 25% at drag 70, 0% at drag 320
       with no surface saving. A cell packed among strangers gets the shelter for
       free; it never needed the bond, and a bonded cell is dragged about by
       partners it cannot leave.

       So the population-level advantage is a GROUP effect, and the world's answer
       to "does multicellularity evolve here" is currently NO. Both facts are
       asserted together, because holding only the first is what produced a
       confident wrong conclusion. */
    const world = {
      loose: equilibrium({ stickiness: 0 }).pop,
      sticky: equilibrium({ stickiness: 1 }).pop,
    };
    expect(world.sticky).toBeGreaterThan(world.loose); // a sticky WORLD is bigger
    expect(compete({})).toBeLessThan(0.5);             // a sticky CELL still loses
  }, 900_000);

  it('and the between-world effect really does need both halves of rule 4', () => {
    /* The central question of the project depends on this. Rule 2 makes clusters
       possible and rule 3 makes them expensive; if nothing makes them worth
       having, a genome will let stickiness drift wherever it likes and
       multicellularity cannot evolve here whatever else is true.

       Surface-to-volume gives the saving. The current is what makes a BOND
       necessary to keep it, by pulling loose clumps apart. Each alone does
       nothing, which is why all three cases are asserted. */
    const paid = {
      loose: equilibrium({ stickiness: 0 }).pop,
      sticky: equilibrium({ stickiness: 1 }).pop,
    };
    const noShelter = {
      loose: equilibrium({ stickiness: 0, upkeepShelter: 0 }).pop,
      sticky: equilibrium({ stickiness: 1, upkeepShelter: 0 }).pop,
    };
    const noCurrent = {
      loose: equilibrium({ stickiness: 0, drag: 0 }).pop,
      sticky: equilibrium({ stickiness: 1, drag: 0 }).pop,
    };

    expect(paid.sticky).toBeGreaterThan(paid.loose);
    expect(noShelter.sticky).toBeLessThan(noShelter.loose);
    expect(noCurrent.sticky).toBeLessThan(noCurrent.loose);
  }, 600_000);
});

describe('movement, scoped to where it is true', () => {
  it('raises carrying capacity IN A STILL WORLD', () => {
    /* Stage 2 predicted this and stage 3 confirmed it — in a world with no
       current, which was the only world there was at the time. Scoped rather
       than deleted: the claim is true where it was measured. */
    const still = equilibrium({ drag: 0, taxis: 0 }).pop;
    const moving = equilibrium({ drag: 0 }).pop;
    expect(moving).toBeGreaterThan(still);
  }, 600_000);

  it('enriches the INDIVIDUAL and impoverishes the WORLD', () => {
    /* The doc called this self-defeating and the measurement said otherwise: a
       cell that can move stands on BETTER ground, which is exactly why the
       behaviour would ever be selected. What gets poorer is the world. A commons
       problem, and the two halves pulling opposite ways is the interesting part.
       Both are asserted together so neither can drift unnoticed. */
    const still = equilibrium({ drag: 0, taxis: 0 });
    const moving = equilibrium({ drag: 0 });
    expect(moving.under).toBeGreaterThan(still.under);
    expect(moving.field).toBeLessThan(still.field);
  }, 600_000);

  it('has an OPTIMUM — it is not a ramp to the ceiling', () => {
    /* An unopposed gene is a constant with a delay. Propulsion is charged by
       force and a cell cannot afford to out-swim the flow, so this stays a real
       choice once it becomes a gene. */
    const chosen = equilibrium({}).pop;
    const frantic = equilibrium({ taxis: BASE.taxis * 20 }).pop;
    expect(frantic).toBeLessThan(chosen);
  }, 600_000);
});

describe('structure over the long run', () => {
  it('patchiness is SUSTAINED, not a colonisation transient', () => {
    /* The stage 3 figure of ~30 patches was itself a colonisation artefact. At
       equilibrium it is far smaller — and the point is that it does not go to
       one, which is what proportional-to-shortfall regrowth produced. */
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
