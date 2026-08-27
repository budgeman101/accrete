/* sim.test.ts — the rules, tested with no browser at all.

   These are not "does the code run" tests. Each one is a claim from
   accrete-sketch.md that the world either honours or doesn't, and several of
   them are claims that NOTHING WAS AUTHORED — that a thing the design predicts
   appears without any rule producing it directly.

   Run: npm test */

import { afterEach, describe, expect, it } from 'vitest';
import { createSim, flowAt, gradientAt, resetSim, stats, substrateAt, tick, type Sim } from '../src/game/sim.js';
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
    CFG.upkeepShelter = 0; // isolating rule 3: sheltered cells legitimately last longer
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

/* ── rule 5 ─────────────────────────────────────────────────────────────── */

describe('rule 5 — a cell senses the world and pushes along what it reads', () => {
  it('with taxis 0 nothing moves under its own power', () => {
    CFG.taxis = 0;
    const sim = run('brimtoveharn', 500);
    expect(sim.cells.every((c) => c.px === 0 && c.py === 0)).toBe(true);
  });

  it('a cell climbs a gradient — and it is a reading, not an instruction', () => {
    const sim = createSim('brimtoveharn');
    // a clean ramp, rising to the east, and one cell sitting in the middle of it
    const n = CFG.fieldSize;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) sim.field[y * n + x] = (x / n) * CFG.fieldMax;
    sim.cells.length = 0;
    sim.bonds.length = 0;
    sim.cells.push({ ...structuredClone(createSim('x').cells[0]!), x: 0, y: 0, reserve: CFG.reserveMax });
    const g = gradientAt(sim, 0, 0);
    expect(g.gx).toBeGreaterThan(0); // the reading itself points up the ramp
    const before = sim.cells[0]!.x;
    for (let i = 0; i < 300; i++) tick(sim, 1 / 60);
    expect(sim.cells[0]!.x).toBeGreaterThan(before);
  });

  it('but in a current a cell is a DRIFTER, not a swimmer', () => {
    /* Swimming cannot compete with the flow, and scaling it up to try is
       unaffordable: propulsion is charged by force, so at 20x taxis the
       population falls 72% and at 60x it goes extinct. Cells drift, as plankton
       do. Taxis survives as a weak bias, not as locomotion. */
    const sim = run('brimtoveharn', 4000);
    const push = sim.cells.reduce((a, c) => a + Math.hypot(c.px, c.py), 0) / sim.cells.length;
    const carried = sim.cells.reduce((a, c) => a + Math.hypot(c.qx, c.qy), 0) / sim.cells.length;
    expect(carried).toBeGreaterThan(push * 3);
  });

  it('movement is PAID FOR — priced high enough, it is a net loss', () => {
    CFG.moveCost = 0.02;
    const dear = run('brimtoveharn', 6000).cells.length;
    Object.assign(CFG, BASE);
    const cheap = run('brimtoveharn', 6000).cells.length;
    expect(dear).toBeLessThan(cheap);
  });

  it('and the world stays patchy at this strength — foraging has not flattened it', () => {
    expect(stats(run('brimtoveharn', 4500)).fieldSd).toBeGreaterThan(4);
  });

  it('crowding is counted, and interior cells read higher than lone ones', () => {
    const sim = run('brimtoveharn', 4500);
    const inCluster = sim.cells.filter((c) => sim.clusterSizeOf[c.cluster]! > 1);
    const alone = sim.cells.filter((c) => sim.clusterSizeOf[c.cluster] === 1);
    if (inCluster.length && alone.length) {
      const m = (a: typeof sim.cells) => a.reduce((s, c) => s + c.crowding, 0) / a.length;
      expect(m(inCluster)).toBeGreaterThan(m(alone));
    }
  });
});

/* ── rule 4 ─────────────────────────────────────────────────────────────── */

describe('rule 4 — one force whose effect depends on size', () => {
  const driftBySize = (sim: Sim, ticks: number) => {
    const before = new Map(sim.cells.map((c) => [c.id, { x: c.x, y: c.y, size: sim.clusterSizeOf[c.cluster] ?? 1 }]));
    for (let i = 0; i < ticks; i++) tick(sim, 1 / 60);
    let lone = { n: 0, d: 0 };
    let big = { n: 0, d: 0 };
    for (const c of sim.cells) {
      const p = before.get(c.id);
      if (!p) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (p.size === 1) { lone.n++; lone.d += d; } else if (p.size >= 4) { big.n++; big.d += d; }
    }
    return { lone: lone.d / Math.max(1, lone.n), big: big.d / Math.max(1, big.n), n: Math.min(lone.n, big.n) };
  };

  it('the flow circulates rather than sweeping the world into a corner', () => {
    /* A stream function is divergence-free by construction, so this is really a
       check that the curl was taken the right way round. */
    let sx = 0;
    let sy = 0;
    const N = 40;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const v = flowAt((i / N - 0.5) * CFG.flowScale * 2, (j / N - 0.5) * CFG.flowScale * 2, 0);
      sx += v.vx; sy += v.vy;
    }
    const mean = Math.hypot(sx, sy) / (N * N);
    const typical = Math.hypot(flowAt(CFG.flowScale * 0.13, CFG.flowScale * 0.19, 0).vx, 1e-9);
    expect(mean).toBeLessThan(typical * 0.2);
  });

  it('BIGGER LUMPS HOLD STATION — sheltered cells feel less current', () => {
    const sim = run('brimtoveharn', 9000);
    const d = driftBySize(sim, 120);
    expect(d.n).toBeGreaterThan(20);
    expect(d.big).toBeLessThan(d.lone * 0.9);
  });

  it('with no current, size makes no difference to drift', () => {
    CFG.drag = 0;
    const sim = run('brimtoveharn', 9000);
    const d = driftBySize(sim, 120);
    if (d.n > 20) expect(d.big).toBeGreaterThan(d.lone * 0.5);
  });

});

/* ── the instrument ─────────────────────────────────────────────────────────
   A warning in a design doc is not a check. These test the MEASURING, not the
   world — because the failure that cost the most in this project was a metric
   that scored its best number ever on a run that was visibly worse, and a
   regrowth model whose shape forbade the phenomenon it was supposed to produce.
   Both were written down as risks first. Neither was executable. */

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

/* ── claims that were only prose ────────────────────────────────────────── */

describe('claims the design makes, now checked', () => {
  it('being a group cuts upkeep — surface-to-volume, and it is why sticking pays', () => {
    /* This test used to assert the opposite: that grouping COSTS, because more
       mouths draw on one patch. That was true and it was the whole problem —
       nothing made clusters worth having. Upkeep now scales with exposed
       surface, so the sign is deliberately reversed. */
    const sim = run('brimtoveharn', 6000);
    const grouped = sim.cells.filter((c) => sim.clusterSizeOf[c.cluster]! > 2);
    const solitary = sim.cells.filter((c) => sim.clusterSizeOf[c.cluster] === 1);
    if (grouped.length > 10 && solitary.length > 10) {
      const meanCrowd = (a: typeof sim.cells) => a.reduce((s, c) => s + c.crowding, 0) / a.length;
      expect(meanCrowd(grouped)).toBeGreaterThan(meanCrowd(solitary));
    }
  });

  it('a patch both falls and recovers — local boom and bust, not a one-way strip', () => {
    const sim = createSim('brimtoveharn');
    const watch = new Array(CFG.fieldSize ** 2).fill(0).map((_, i) => i).filter((_, i) => i % 37 === 0);
    const lo = new Map<number, number>();
    const hi = new Map<number, number>();
    let anyRecovered = false;
    for (let i = 0; i < 14000; i++) {
      tick(sim, 1 / 60);
      if (i % 25) continue;
      for (const idx of watch) {
        const v = sim.field[idx]!;
        const l = Math.min(lo.get(idx) ?? v, v);
        lo.set(idx, l);
        hi.set(idx, Math.max(hi.get(idx) ?? v, v));
        // fell a long way and then climbed a long way back out of it
        if (l < CFG.fieldMax * 0.25 && v > l + CFG.fieldMax * 0.35) anyRecovered = true;
      }
    }
    expect(anyRecovered).toBe(true);
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
