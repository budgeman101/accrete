/* sim.ts — the world and its rules. NO DOM, NO PIXI, NO DRAWING.

   STAGE 1 of Accrete: fracture physics. See accrete-sketch.md for the design.

   What is here: cells that bud, bonds that may form between parent and daughter,
   solid cells that push each other apart, and bonds that SNAP when the strain
   from packing exceeds what they can take.

   What is deliberately NOT here: the world layer, upkeep, sensing, genomes,
   death, evolution. This stage answers one question — do lumps grow and break
   at sizes that come out of the packing rather than out of a number anyone
   wrote? Nowhere in this file is there a rule that says "split at N cells".

   THE ONE COMMITMENT: identity is DERIVED, never stored. There is no array of
   organisms. A cluster is whatever is currently connected by live bonds, worked
   out fresh each tick. That is what lets the same code mean "cell" at one scale
   and "cluster" at the next — it never knew the difference.

   Everything random comes from an injected seeded Rng, never Math.random, so the
   same seed always replays the same run. */

import { CFG } from './cfg.js';
import { makeRng, type Rng } from '../kit/rng.js';

export interface Cell {
  x: number;
  y: number;
  /** Force accumulator, cleared every substep. */
  fx: number;
  fy: number;
  r: number;
  /** Ticks until this cell buds. */
  clock: number;
  /** Which connected component it is in this tick. Derived, never authoritative. */
  cluster: number;
  /** For colouring and lineage only — never read by the physics. */
  birthTick: number;
}

export interface Bond {
  a: number;
  b: number;
  /** Tension this bond survives. Above it, it snaps. */
  strength: number;
  /** Tension it is currently under, for drawing and for the break check. */
  tension: number;
  live: boolean;
}

export interface Sim {
  t: number;
  tick: number;
  cells: Cell[];
  bonds: Bond[];
  rng: Rng;
  /** Forked ONCE. Forking per tick re-hashes a seed string every frame, which
      turned out to be most of the run cost. */
  budRng: Rng;
  seed: string;
  /** Bonds that snapped on this tick — set for exactly one tick. */
  fracturesThisTick: number;
  totalFractures: number;
  /** Derived each tick: sizes of every connected component, descending. */
  clusterSizes: number[];
}

export function createSim(seed: string): Sim {
  const rng = makeRng(seed);
  const place = rng.fork('place');
  const clock = rng.fork('clock');

  const cells: Cell[] = [];
  for (let i = 0; i < CFG.seedCount; i++) {
    const a = place.range(0, Math.PI * 2);
    const d = Math.sqrt(place()) * CFG.seedSpread;
    cells.push(makeCell(Math.cos(a) * d, Math.sin(a) * d, clock, 0));
  }

  const sim: Sim = {
    t: 0,
    tick: 0,
    cells,
    bonds: [],
    rng,
    budRng: rng.fork('bud'),
    seed,
    fracturesThisTick: 0,
    totalFractures: 0,
    clusterSizes: [],
  };
  recomputeClusters(sim);
  return sim;
}

function makeCell(x: number, y: number, clockRng: Rng, birthTick: number): Cell {
  const jitter = 1 + clockRng.range(-CFG.growthJitter, CFG.growthJitter);
  return {
    x,
    y,
    fx: 0,
    fy: 0,
    r: CFG.cellRadius,
    clock: Math.max(1, Math.round(CFG.growthInterval * jitter)),
    cluster: -1,
    birthTick,
  };
}

/* ── the tick ───────────────────────────────────────────────────────────────
   dt is accepted for interface compatibility with the kit loop, which is fixed-
   timestep. The sim itself is tick-based on purpose: growth clocks counted in
   ticks replay identically, where clocks counted in seconds drift with it. */
export function tick(sim: Sim, dt: number): void {
  sim.t += dt;
  sim.tick++;
  sim.fracturesThisTick = 0;

  for (let s = 0; s < CFG.substeps; s++) {
    accumulateForces(sim);
    integrate(sim);
  }

  breakOverstressedBonds(sim);
  grow(sim);
  recomputeClusters(sim);
}

/* ── forces ─────────────────────────────────────────────────────────────────
   Two of them, and neither knows what a cluster is.

   Repulsion: cells are solid and cannot interpenetrate. This is the force that
   crowding turns into strain — as a lump fills in, interior cells push outward
   against the bonds holding the thing together.

   Bonds: a spring between parent and daughter. Its tension is what eventually
   exceeds its strength. Nothing counts cells. */
function accumulateForces(sim: Sim): void {
  const cells = sim.cells;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    c.fx = 0;
    c.fy = 0;
  }

  // spatial hash so this stays O(n) rather than O(n^2) at four thousand cells
  const cs = CFG.cellRadius * 2.2;
  const buckets = new Map<number, number[]>();
  const key = (gx: number, gy: number) => gx * 73856093 ^ gy * 19349663;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    const gx = Math.floor(c.x / cs);
    const gy = Math.floor(c.y / cs);
    const k = key(gx, gy);
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  }

  for (let i = 0; i < cells.length; i++) {
    const ci = cells[i]!;
    const gx = Math.floor(ci.x / cs);
    const gy = Math.floor(ci.y / cs);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const b = buckets.get(key(gx + ox, gy + oy));
        if (!b) continue;
        for (const j of b) {
          if (j <= i) continue; // each pair once
          const cj = cells[j]!;
          const dx = cj.x - ci.x;
          const dy = cj.y - ci.y;
          const d2 = dx * dx + dy * dy;
          const rest = ci.r + cj.r;
          if (d2 >= rest * rest || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const overlap = rest - d;
          const f = CFG.repulsion * overlap;
          const nx = dx / d;
          const ny = dy / d;
          ci.fx -= nx * f;
          ci.fy -= ny * f;
          cj.fx += nx * f;
          cj.fy += ny * f;
        }
      }
    }
  }

  for (const bond of sim.bonds) {
    if (!bond.live) continue;
    const a = cells[bond.a]!;
    const b = cells[bond.b]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    const rest = (a.r + b.r) * CFG.bondRest;
    const stretch = d - rest;
    const f = CFG.bondStiffness * stretch;
    // tension is stretch only; a bond being squashed is not being torn
    bond.tension = Math.max(0, f);
    const nx = dx / d;
    const ny = dy / d;
    a.fx += nx * f;
    a.fy += ny * f;
    b.fx -= nx * f;
    b.fy -= ny * f;
  }
}

/** Overdamped — no velocity, no inertia. A cell this size lives in treacle.
    Steps are clamped: see CFG.maxStep for why that clamp is load-bearing. */
function integrate(sim: Sim): void {
  const m = CFG.mobility / CFG.substeps;
  const cap = CFG.cellRadius * CFG.maxStep;
  for (const c of sim.cells) {
    let dx = c.fx * m;
    let dy = c.fy * m;
    const step = Math.hypot(dx, dy);
    if (step > cap) {
      const k = cap / step;
      dx *= k;
      dy *= k;
    }
    c.x += dx;
    c.y += dy;
  }
}

/* ── fracture ───────────────────────────────────────────────────────────────
   The whole point. Nobody decides a cluster should divide; a bond somewhere in
   it is simply carrying more than it can hold, and lets go. Where it lets go —
   and therefore how big the two pieces are — falls out of the shape. */
function breakOverstressedBonds(sim: Sim): void {
  for (const bond of sim.bonds) {
    if (!bond.live) continue;
    if (bond.tension > bond.strength) {
      bond.live = false;
      sim.fracturesThisTick++;
      sim.totalFractures++;
    }
  }
}

/* ── growth ─────────────────────────────────────────────────────────────────
   A cell buds. The daughter appears touching it, and whether it STAYS attached
   is the stickiness dial — the thing that becomes a gene in stage 3. At zero it
   separates cleanly and the world is unicellular forever. */
function grow(sim: Sim): void {
  if (sim.cells.length >= CFG.maxCells) return;
  const budRng = sim.budRng;
  const n = sim.cells.length;
  for (let i = 0; i < n; i++) {
    const parent = sim.cells[i]!;
    if (--parent.clock > 0) continue;
    if (sim.cells.length >= CFG.maxCells) break;

    const a = budRng.range(0, Math.PI * 2);
    const d = (parent.r + CFG.cellRadius) * CFG.budOffset; // touching, not inside
    const child = makeCell(parent.x + Math.cos(a) * d, parent.y + Math.sin(a) * d, budRng, sim.tick);
    parent.clock = Math.max(1, Math.round(CFG.growthInterval * (1 + budRng.range(-CFG.growthJitter, CFG.growthJitter))));
    const idx = sim.cells.push(child) - 1;

    if (CFG.stickiness > 0) {
      sim.bonds.push({
        a: i,
        b: idx,
        strength: CFG.stickiness * CFG.bondStrengthMax,
        tension: 0,
        live: true,
      });
    }
  }
}

/* ── identity, derived ──────────────────────────────────────────────────────
   There is no organism list. Follow the live bonds; whatever is connected is a
   thing. Run it on a world of loose cells and every cell is its own cluster of
   one, with no special case for "unicellular" anywhere. */
export function recomputeClusters(sim: Sim): void {
  const cells = sim.cells;
  const n = cells.length;

  /* Adjacency as flat arrays (counts -> offsets -> fill) rather than n little
     JS arrays. At four thousand cells every tick, allocating n arrays per tick
     was the single largest cost in the whole sim. */
  const deg = new Int32Array(n + 1);
  let edges = 0;
  for (const b of sim.bonds) {
    if (!b.live) continue;
    deg[b.a] = deg[b.a]! + 1;
    deg[b.b] = deg[b.b]! + 1;
    edges += 2;
  }
  const off = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) off[i + 1] = off[i]! + deg[i]!;
  const fill = off.slice();
  const adj = new Int32Array(edges);
  for (const b of sim.bonds) {
    if (!b.live) continue;
    adj[fill[b.a]!] = b.b;
    fill[b.a] = fill[b.a]! + 1;
    adj[fill[b.b]!] = b.a;
    fill[b.b] = fill[b.b]! + 1;
  }

  for (let i = 0; i < n; i++) cells[i]!.cluster = -1;
  const sizes: number[] = [];
  let id = 0;
  const stack = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (cells[i]!.cluster !== -1) continue;
    let size = 0;
    let sp = 0;
    stack[sp++] = i;
    cells[i]!.cluster = id;
    while (sp > 0) {
      const v = stack[--sp]!;
      size++;
      for (let e = off[v]!; e < off[v + 1]!; e++) {
        const w = adj[e]!;
        if (cells[w]!.cluster === -1) {
          cells[w]!.cluster = id;
          stack[sp++] = w;
        }
      }
    }
    sizes.push(size);
    id++;
  }
  sizes.sort((a, b) => b - a);
  sim.clusterSizes = sizes;
}

/* ── readouts ───────────────────────────────────────────────────────────────
   Instrumentation is not decoration here. Without a number coming out, this is
   a screensaver rather than the experiment. */
export interface Stats {
  cells: number;
  clusters: number;
  largest: number;
  meanClusterSize: number;
  liveBonds: number;
  totalFractures: number;
}

export function stats(sim: Sim): Stats {
  const sizes = sim.clusterSizes;
  const total = sizes.reduce((a, b) => a + b, 0);
  return {
    cells: sim.cells.length,
    clusters: sizes.length,
    largest: sizes[0] ?? 0,
    meanClusterSize: sizes.length ? total / sizes.length : 0,
    liveBonds: sim.bonds.reduce((n, b) => n + (b.live ? 1 : 0), 0),
    totalFractures: sim.totalFractures,
  };
}

/**
 * Reset in place, optionally with a new seed.
 * Exposed on window.DBG so a test can drive from a KNOWN state — without it,
 * however carefully you step, the real time between page load and the first
 * assertion has already moved the sim, and the run isn't reproducible.
 */
export function resetSim(sim: Sim, seed = sim.seed): void {
  const fresh = createSim(seed);
  sim.t = 0;
  sim.tick = 0;
  sim.cells = fresh.cells;
  sim.bonds = fresh.bonds;
  sim.rng = fresh.rng;
  sim.budRng = fresh.budRng;
  sim.seed = fresh.seed;
  sim.fracturesThisTick = 0;
  sim.totalFractures = 0;
  sim.clusterSizes = fresh.clusterSizes;
}
