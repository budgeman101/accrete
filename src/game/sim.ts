/* sim.ts — the world and its rules. NO DOM, NO PIXI, NO DRAWING.

   Accrete. See accrete-sketch.md for the design and the reasoning.

   RULE 1 — the world keeps what agents do to it. A substrate field that holds
   what the world has and remembers what has been taken, regenerating toward full
   at rate R. R is the one world constant: how fast the world forgets.

   RULE 2 — separation after division can fail. A daughter may stay bonded to its
   parent. Cells are solid, crowding turns into strain, and bonds SNAP. Nothing
   anywhere says "split at N cells": where a lump breaks, and therefore how big
   the pieces are, falls out of its shape.

   RULE 3 — existing draws from the layer where you are. Upkeep is not a property
   of the cell, it is a withdrawal from the field rule 1 already established.
   There is no energy stat. Stand still, spoil your patch, and starve in it.

   Growth is NOT scheduled. A cell buds when it has surplus, so the substrate
   under it decides how fast it grows, and the jitter a timer needed comes free
   from the fact that no two places are equally rich.

   NOT HERE YET: sensing, emission, genomes, evolution, shape. Cells are circles
   and every one of them is identical.

   THE ONE COMMITMENT: identity is DERIVED, never stored. There is no array of
   organisms. A cluster is whatever is currently connected by live bonds, worked
   out fresh each tick — which is what lets the same code mean "cell" at one
   scale and "cluster" at the next. It never knew the difference.

   Everything random comes from an injected seeded Rng, never Math.random. */

import { CFG } from './cfg.js';
import { makeRng, type Rng } from '../kit/rng.js';

export interface Cell {
  x: number;
  y: number;
  /** Force accumulator, cleared every substep. */
  fx: number;
  fy: number;
  r: number;
  /** What it has in hand. Upkeep comes out of this; surplus makes a daughter. */
  reserve: number;
  /** Propulsion this cell is applying, recomputed once a tick and added in every
      substep. Charged for in metabolise. */
  px: number;
  py: number;
  /** How many cells are touching it, counted during the force pass. Free there,
      and it is the sense that tells an interior cell it is interior. */
  crowding: number;
  /** Which connected component it is in this tick. Derived, never authoritative. */
  cluster: number;
  /** Lineage and colour only — never read by the physics. */
  birthTick: number;
  alive: boolean;
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
  /** Rule 1: the layer. Row-major, CFG.fieldSize squared. */
  field: Float32Array;
  rng: Rng;
  budRng: Rng;
  seed: string;
  fracturesThisTick: number;
  totalFractures: number;
  deathsThisTick: number;
  totalDeaths: number;
  birthsThisTick: number;
  /** Derived each tick: sizes of every connected component, descending. For
      reporting only — it is SORTED, so it cannot be indexed by a cell's cluster
      id. Use clusterSizeOf for that. */
  clusterSizes: number[];
  /** Size of each cluster, indexed by cluster id as cells carry it. */
  clusterSizeOf: number[];
}

/* ── the field ──────────────────────────────────────────────────────────────
   World coordinates are centred on the field. Outside it there is simply no
   substrate, so the world is bounded by starvation and the edge needs no rule of
   its own — wander off and there is nothing to eat. */

const half = () => (CFG.fieldSize * CFG.fieldCell) / 2;

export function fieldIndexAt(x: number, y: number): number {
  const gx = Math.floor((x + half()) / CFG.fieldCell);
  const gy = Math.floor((y + half()) / CFG.fieldCell);
  if (gx < 0 || gy < 0 || gx >= CFG.fieldSize || gy >= CFG.fieldSize) return -1;
  return gy * CFG.fieldSize + gx;
}

/** Bilinear, not nearest. A cell straddling two patches should see the blend,
    or the world has invisible cliffs in it that nothing in the design put there.
    This is also what rule 5's gradient will be read from. */
export function substrateAt(sim: Sim, x: number, y: number): number {
  const n = CFG.fieldSize;
  const gx = (x + half()) / CFG.fieldCell - 0.5;
  const gy = (y + half()) / CFG.fieldCell - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  let v = 0;
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const cx = x0 + dx;
      const cy = y0 + dy;
      if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
      v += w * sim.field[cy * n + cx]!;
    }
  }
  return v;
}

/** Substrate gradient, by central difference over one patch of the same bilinear
    field a cell draws from. This is the only thing a cell senses about the world
    beyond its own body — and it is a READING, not an instruction. */
export function gradientAt(sim: Sim, x: number, y: number): { gx: number; gy: number } {
  const h = CFG.fieldCell;
  return {
    gx: (substrateAt(sim, x + h, y) - substrateAt(sim, x - h, y)) / (2 * h),
    gy: (substrateAt(sim, x, y + h) - substrateAt(sim, x, y - h)) / (2 * h),
  };
}

/** Take `amount` from around (x,y), spread over the four nearest patches by the
    same weights substrateAt reads them with. Returns what was actually got —
    less than asked for when the ground is thin. */
function drawFrom(sim: Sim, x: number, y: number, amount: number): number {
  const n = CFG.fieldSize;
  const gx = (x + half()) / CFG.fieldCell - 0.5;
  const gy = (y + half()) / CFG.fieldCell - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  let got = 0;
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const cx = x0 + dx;
      const cy = y0 + dy;
      if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
      const i = cy * n + cx;
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
      const take = Math.min(amount * w, sim.field[i]!);
      sim.field[i] = sim.field[i]! - take;
      got += take;
    }
  }
  return got;
}

export function createSim(seed: string): Sim {
  const rng = makeRng(seed);
  const place = rng.fork('place');

  const field = new Float32Array(CFG.fieldSize * CFG.fieldSize).fill(CFG.fieldMax);

  const cells: Cell[] = [];
  for (let i = 0; i < CFG.seedCount; i++) {
    const a = place.range(0, Math.PI * 2);
    const d = Math.sqrt(place()) * CFG.seedSpread;
    cells.push(makeCell(Math.cos(a) * d, Math.sin(a) * d, 0));
  }

  const sim: Sim = {
    t: 0,
    tick: 0,
    cells,
    bonds: [],
    field,
    rng,
    budRng: rng.fork('bud'),
    seed,
    fracturesThisTick: 0,
    totalFractures: 0,
    deathsThisTick: 0,
    totalDeaths: 0,
    birthsThisTick: 0,
    clusterSizes: [],
    clusterSizeOf: [],
  };
  recomputeClusters(sim);
  return sim;
}

function makeCell(x: number, y: number, birthTick: number, reserve = CFG.reserveMax * CFG.reserveAtBirth): Cell {
  return {
    x,
    y,
    fx: 0,
    fy: 0,
    px: 0,
    py: 0,
    crowding: 0,
    r: CFG.cellRadius,
    reserve,
    cluster: -1,
    birthTick,
    alive: true,
  };
}

/* ── the tick ───────────────────────────────────────────────────────────────
   dt is accepted for interface compatibility with the kit loop, which is fixed-
   timestep. The sim itself is tick-based on purpose: rates counted in ticks
   replay identically, where rates counted in seconds drift with the frame. */
export function tick(sim: Sim, dt: number): void {
  sim.t += dt;
  sim.tick++;
  sim.fracturesThisTick = 0;
  sim.deathsThisTick = 0;
  sim.birthsThisTick = 0;

  sense(sim);

  for (let s = 0; s < CFG.substeps; s++) {
    accumulateForces(sim);
    integrate(sim);
  }

  breakOverstressedBonds(sim);
  metabolise(sim);
  grow(sim);
  regenerate(sim);
  compact(sim);
  recomputeClusters(sim);
}

/* ── rule 5: sensing ────────────────────────────────────────────────────────
   Read the world, decide a push. Once per tick, not once per substep — the
   reading does not change inside a tick and re-sampling it four times would
   just be four times the cost for the same answer.

   Nothing here says "go where the food is". It says: push along the gradient by
   this much. A negative strength would push the other way and everything would
   starve, and no rule in this file would object. */
function sense(sim: Sim): void {
  if (CFG.taxis === 0) {
    for (const c of sim.cells) { c.px = 0; c.py = 0; }
    return;
  }
  for (const c of sim.cells) {
    const g = gradientAt(sim, c.x, c.y);
    c.px = CFG.taxis * g.gx;
    c.py = CFG.taxis * g.gy;
  }
}

/* ── forces ─────────────────────────────────────────────────────────────────
   Two, and neither knows what a cluster is. Repulsion because cells are solid;
   a bond spring between parent and daughter whose tension is what eventually
   exceeds its strength. Nothing counts cells. */
function accumulateForces(sim: Sim): void {
  const cells = sim.cells;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    // propulsion is a force like any other, so it argues with repulsion and with
    // whatever a cell is bonded to rather than overriding them
    c.fx = c.px;
    c.fy = c.py;
    c.crowding = 0;
  }

  // spatial hash so this stays O(n) rather than O(n^2)
  const cs = CFG.cellRadius * 2.2;
  const buckets = new Map<number, number[]>();
  const key = (gx: number, gy: number) => gx * 73856093 ^ gy * 19349663;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    const k = key(Math.floor(c.x / cs), Math.floor(c.y / cs));
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

          /* Crowding counts NEIGHBOURS, not overlaps. A bonded pair rests at
             exactly the contact distance and so never overlaps at all — counting
             only overlaps made a cell inside a cluster read as less crowded than
             a loose cell in a crush, which is backwards for the one sense that is
             supposed to tell an interior cell that it is interior. */
          const near = rest * 1.3;
          if (d2 < near * near) {
            ci.crowding++;
            cj.crowding++;
          }

          if (d2 >= rest * rest || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const f = CFG.repulsion * (rest - d);
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
    const f = CFG.bondStiffness * (d - rest);
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
   Nobody decides a cluster should divide. A bond somewhere in it is carrying
   more than it can hold, and lets go. */
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

/* ── rule 3: existing costs, and the cost comes out of the world ────────────
   A cell draws what it can from the field cell it stands on and pays upkeep out
   of what it holds. The withdrawal is written back into the layer and stays
   there until the layer regenerates — which is rule 1 doing its work.

   Nothing here says "seek food". A cell that cannot cover upkeep simply stops
   being one of the cells. */
function metabolise(sim: Sim): void {
  for (const c of sim.cells) {
    const want = Math.min(CFG.drawRate, CFG.reserveMax - c.reserve);
    if (want > 0) c.reserve += drawFrom(sim, c.x, c.y, want);
    c.reserve -= CFG.upkeep + CFG.moveCost * Math.hypot(c.px, c.py);
    if (c.reserve <= 0) {
      c.alive = false;
      sim.deathsThisTick++;
      sim.totalDeaths++;
    }
  }
}

/* ── growth ─────────────────────────────────────────────────────────────────
   A cell with surplus divides, and the two of them split what it had. Whether
   the daughter STAYS attached is the stickiness dial — the thing that becomes a
   gene once genomes exist. At zero it separates cleanly and the world is
   unicellular forever. */
function grow(sim: Sim): void {
  const budRng = sim.budRng;
  const n = sim.cells.length;
  const threshold = CFG.reserveMax * CFG.budThreshold;
  for (let i = 0; i < n; i++) {
    const parent = sim.cells[i]!;
    if (!parent.alive || parent.reserve < threshold) continue;
    if (sim.cells.length >= CFG.maxCells) break;

    const a = budRng.range(0, Math.PI * 2);
    const d = (parent.r + CFG.cellRadius) * CFG.budOffset; // touching, not inside
    const share = parent.reserve / 2;
    parent.reserve = share;
    const child = makeCell(parent.x + Math.cos(a) * d, parent.y + Math.sin(a) * d, sim.tick, share);
    const idx = sim.cells.push(child) - 1;
    sim.birthsThisTick++;

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

/** Rule 1's other half: the world forgets, at rate R, and no faster — plus
    substrate spreading sideways, which is what stops the field's grid from
    showing through as tiles and lets a spoiled patch be refilled by its
    neighbours as well as by time. */
function regenerate(sim: Sim): void {
  const f = sim.field;
  const n = CFG.fieldSize;
  const max = CFG.fieldMax;
  const r = CFG.regen;
  const d = CFG.diffuse;

  if (d > 0) {
    const src = f.slice();
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const v = src[i]!;
        // edges reflect: a boundary cell simply has fewer neighbours to average
        let sum = 0;
        let k = 0;
        if (x > 0) { sum += src[i - 1]!; k++; }
        if (x < n - 1) { sum += src[i + 1]!; k++; }
        if (y > 0) { sum += src[i - n]!; k++; }
        if (y < n - 1) { sum += src[i + n]!; k++; }
        f[i] = v + d * (sum / k - v);
      }
    }
  }

  /* LOGISTIC, not proportional-to-shortfall. The difference decides whether the
     world can have deserts in it.

     Growing back by a fraction of the SHORTFALL means bare ground regenerates
     FASTEST of all — so nothing can ever stay stripped, every grazed patch
     springs back at full speed, and the whole world settles into one uniformly
     cropped flux. Measured: by tick 40,000 all 1600 patches were a single bare
     region at 0.2% of full.

     Substrate is growing stuff, and growing stuff grows from what is already
     there. Logistically, bare ground is nearly DEAD ground: it comes back only
     as fast as its neighbours can seed it, which is what diffusion is for. That
     is what lets a place be ruined rather than merely used. */
  for (let i = 0; i < f.length; i++) {
    const v = f[i]!;
    if (v > 0 && v < max) f[i] = v + r * v * (1 - v / max);
  }
}

/* ── compaction ─────────────────────────────────────────────────────────────
   Bonds hold cell INDICES, so removing a dead cell means remapping them. Doing
   it here, once, keeps every other loop free of liveness checks. */
function compact(sim: Sim): void {
  if (sim.deathsThisTick === 0) {
    if (sim.fracturesThisTick > 0) sim.bonds = sim.bonds.filter((b) => b.live);
    return;
  }

  const remap = new Int32Array(sim.cells.length).fill(-1);
  const kept: Cell[] = [];
  for (let i = 0; i < sim.cells.length; i++) {
    const c = sim.cells[i]!;
    if (!c.alive) continue;
    remap[i] = kept.length;
    kept.push(c);
  }
  sim.cells = kept;

  const bonds: Bond[] = [];
  for (const b of sim.bonds) {
    if (!b.live) continue;
    const a = remap[b.a]!;
    const c = remap[b.b]!;
    if (a < 0 || c < 0) continue; // a bond to a dead cell is not a bond
    b.a = a;
    b.b = c;
    bonds.push(b);
  }
  sim.bonds = bonds;
}

/* ── identity, derived ──────────────────────────────────────────────────────
   There is no organism list. Follow the live bonds; whatever is connected is a
   thing. Run it on a world of loose cells and every cell is its own cluster of
   one, with no special case for "unicellular" anywhere. */
export function recomputeClusters(sim: Sim): void {
  const cells = sim.cells;
  const n = cells.length;

  /* Adjacency as flat arrays (counts -> offsets -> fill) rather than n little
     JS arrays. At a few thousand cells every tick, allocating n arrays per tick
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
  sim.clusterSizeOf = sizes;
  sim.clusterSizes = sizes.slice().sort((a, b) => b - a);
}

/* ── readouts ───────────────────────────────────────────────────────────────
   Instrumentation is not decoration. Without a number coming out, this is a
   screensaver rather than the experiment. */
export interface Stats {
  cells: number;
  clusters: number;
  largest: number;
  meanClusterSize: number;
  liveBonds: number;
  totalFractures: number;
  totalDeaths: number;
  /** Mean substrate across the whole field. How spoiled the world is. */
  fieldMean: number;
  /** Spread of substrate. Zero at the start, so anything above it was made by
      the cells — but it measures CONTRAST, not structure: a world stripped on
      one side and untouched on the other scores as high as one full of patches.
      Kept because it is the honest "did they change anything" number; use the
      two below to ask whether what they made has any grain to it. */
  fieldSd: number;
  /** Connected regions of spoiled ground. THIS is patchiness: it tells apart a
      hundred grazed clearings from one continent-sized bare patch, which sd
      cannot. */
  patchCount: number;
  /** Mean size of those regions, in field cells. Rising while patchCount falls
      is the signature of a world being grazed uniformly bare. */
  meanPatchSize: number;
  meanReserve: number;
}

export function stats(sim: Sim): Stats {
  const sizes = sim.clusterSizes;
  const total = sizes.reduce((a, b) => a + b, 0);
  const f = sim.field;
  let sum = 0;
  for (let i = 0; i < f.length; i++) sum += f[i]!;
  const mean = f.length ? sum / f.length : 0;
  let vs = 0;
  for (let i = 0; i < f.length; i++) {
    const d = f[i]! - mean;
    vs += d * d;
  }
  /* Connected components of spoiled ground, four-way. Threshold at half full:
     it wants to be well inside the range the field actually produces, not at an
     extreme where everything or nothing qualifies. */
  const n = CFG.fieldSize;
  const spoiled = CFG.fieldMax * 0.5;
  const seen = new Uint8Array(f.length);
  const stack: number[] = [];
  let patchCount = 0;
  let patchCells = 0;
  for (let i = 0; i < f.length; i++) {
    if (seen[i] || f[i]! >= spoiled) continue;
    patchCount++;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const v = stack.pop()!;
      patchCells++;
      const vx = v % n;
      const vy = (v / n) | 0;
      if (vx > 0 && !seen[v - 1] && f[v - 1]! < spoiled) { seen[v - 1] = 1; stack.push(v - 1); }
      if (vx < n - 1 && !seen[v + 1] && f[v + 1]! < spoiled) { seen[v + 1] = 1; stack.push(v + 1); }
      if (vy > 0 && !seen[v - n] && f[v - n]! < spoiled) { seen[v - n] = 1; stack.push(v - n); }
      if (vy < n - 1 && !seen[v + n] && f[v + n]! < spoiled) { seen[v + n] = 1; stack.push(v + n); }
    }
  }

  return {
    cells: sim.cells.length,
    clusters: sizes.length,
    largest: sizes[0] ?? 0,
    meanClusterSize: sizes.length ? total / sizes.length : 0,
    liveBonds: sim.bonds.reduce((n, b) => n + (b.live ? 1 : 0), 0),
    totalFractures: sim.totalFractures,
    totalDeaths: sim.totalDeaths,
    fieldMean: mean,
    fieldSd: f.length ? Math.sqrt(vs / f.length) : 0,
    patchCount,
    meanPatchSize: patchCount ? patchCells / patchCount : 0,
    meanReserve: sim.cells.length ? sim.cells.reduce((a, c) => a + c.reserve, 0) / sim.cells.length : 0,
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
  sim.field = fresh.field;
  sim.rng = fresh.rng;
  sim.budRng = fresh.budRng;
  sim.seed = fresh.seed;
  sim.fracturesThisTick = 0;
  sim.totalFractures = 0;
  sim.deathsThisTick = 0;
  sim.totalDeaths = 0;
  sim.birthsThisTick = 0;
  sim.clusterSizes = fresh.clusterSizes;
  sim.clusterSizeOf = fresh.clusterSizeOf;
}
