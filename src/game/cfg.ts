/* cfg.ts — EVERY tunable number, in one place.

   THE RULE: logic reads from CFG and never hardcodes a number. That's what makes
   the inspector work (drag a slider, the game changes now) and what keeps
   balancing surgical. If you find yourself typing a magic number into sim.ts,
   it belongs here instead.

   Values here are the STARTING point, not the truth — tune them live with the
   inspector (` to open), then Copy CFG and paste the block back over this one.

   SPIKE 1 — fracture physics only. No world layer, no genome, no evolution.
   The question this stage answers: do lumps grow, and do they break, at sizes
   that come out of the packing rather than out of a number anyone wrote?

   Cells are CIRCLES here. Shape is deliberately staged, not deleted — the
   sketch is explicit that shape is the lever evolution reaches for (13x more
   effective than glue), and capsules arrive with the genome. Recorded so it
   cannot quietly become permanent. */

export const CFG = {
  // ---- the cell ----
  /** Radius of one cell, in world units. Everything else is scaled to this. */
  cellRadius: 5,
  /** Ticks between one cell budding and the next. Lower = faster growth. Slower
      growth lets a cluster relax between buds and reach a larger size before the
      packing tears it (13 at 300 versus 9 at 90). */
  growthInterval: 300,
  /** Jitter on the growth clock, as a fraction — without it every cell in a
      cluster buds on the same tick and the whole thing pulses. */
  growthJitter: 0.35,

  // ---- the physics ----
  /** Overdamped: position += force * mobility. No inertia — cells live in
      treacle, which is what a cell at this scale actually experiences. */
  mobility: 0.0035,
  /** How hard two overlapping cells push apart, per unit of overlap. MEASURED,
      not picked: at 260 the worst interpenetration anywhere in a settled cluster
      is 0%, at 120 it is 23%, at 60 it is 71% — cells passing through each other
      rather than being solid. Softer cells buy much bigger clusters (largest 51
      at repulsion 30 versus 13 at 260) and the price is solidity, which enclosure
      and packing both depend on. Held at 260. */
  repulsion: 260,
  /** Spring constant of a bond, per unit of stretch or compression. Paired with
      bondStrengthMax so that breaking stretch stays a fraction of a cell rather
      than more than a diameter — see there. */
  bondStiffness: 400,
  /** Bond rest length as a multiple of (r1 + r2). MUST NOT be under 1: below
      that, repulsion holds a bonded pair further apart than the bond wants, so
      every bond sits under permanent tension and an isolated pair tears itself
      apart with no crowding involved. At 1 the rest length IS the contact
      distance, a lone pair is at zero tension, and all strain comes from
      packing — which is the mechanism this whole stage exists to test. */
  bondRest: 1,

  // ---- the one hand-set gene (becomes evolvable in stage 3) ----
  /** 0 = daughters always separate cleanly (unicellular).
      1 = the bond is as strong as this world allows.
      This is "separation after division can fail" as a dial, before it is a gene. */
  stickiness: 0.6,
  /** Tension a bond survives at stickiness 1. Fracture happens when the strain
      the packing generates exceeds this — nothing anywhere says "split at N".

      READ WITH bondStiffness: breaking stretch is bondStrengthMax/bondStiffness.
      At 400/400 that is 1.0 world unit, 20% of a cell radius, and every live bond
      in a settled cluster measures exactly the contact distance — glue. An earlier
      pairing of 1200/90 gave far bigger clusters and a breaking stretch of 13.3
      units: bonded cells sitting more than two diameters apart. That is a rubber
      band, not a cell junction, and the cluster sizes it bought were not real. */
  bondStrengthMax: 400,

  // ---- the run ----
  /** Hard ceiling so a runaway can't hang the tab. Not a biological limit. */
  maxCells: 4000,
  /** Cells seeded at the start, scattered in a disc of this radius. */
  seedCount: 8,
  seedSpread: 90,
  /** Physics substeps per tick. More = stiffer springs stay stable. */
  substeps: 4,
  /** Hard cap on how far one cell may move in one substep, as a fraction of its
      radius. Without it an explicit integrator can overshoot a rest length and
      manufacture tension out of nothing — which is exactly what was snapping
      every bond before crowding had any say. A stabiliser, not a rule. */
  maxStep: 0.25,
  /** Where a daughter appears, as a multiple of (r_parent + r_child). At 1 it is
      touching. Below 1 it starts INSIDE its parent, and the resulting repulsion
      impulse throws the pair apart hard enough to snap their own bond on the
      first tick — a birth artefact masquerading as fracture. */
  budOffset: 1,
};

export type Cfg = typeof CFG;
