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
  /* Growth is no longer a clock. A cell buds when it has SURPLUS — see
     budThreshold below. Nothing schedules division; it is what happens when a
     cell has more than it needs, which means the substrate under it decides how
     fast it grows, and the jitter that a timer needed comes free from the fact
     that no two places are equally rich. */

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

  // ---- rule 1 + rule 3: the world layer, and the upkeep drawn from it ----
  /* These are ONE mechanism. The layer holds what the world has and remembers
     what has been taken from it; upkeep is a withdrawal from that same layer.
     There is no separate energy stat anywhere. */

  /** Field cell size in world units. DELIBERATELY COARSER THAN A CELL (which is
      10 across). Carrying capacity works out to fieldCells x (fieldMax x regen /
      upkeep), and sustaining a lone cell needs that ratio at or above 1 — so
      capacity can never fall below the number of field cells. With a field as
      fine as a cell that forces a world packed shoulder to shoulder. A patch
      three cells wide gives room to be sparse. */
  fieldCell: 30,
  /** Field width and height in field cells. Outside it there is no substrate at
      all, so the world is bounded by starvation rather than by a wall — nothing
      needs a special case for the edge. */
  fieldSize: 40,
  /** Substrate a full field cell holds. Stock, not rate: this is how long a
      patch can carry a cell before regeneration is all there is. */
  fieldMax: 20,
  /** THE world constant: how fast the world forgets. Logistic — substrate grows
      from what is already there, so bare ground is nearly dead ground and comes
      back only as its neighbours seed it. Too fast and nothing is ever at risk;
      too slow and everything starves.

      MEASURED, with diffuse at 0.002: 0.004 gives 50 depleted patches averaging
      10 field cells on a healthy field; 0.015 gives 33 patches averaging 26 and
      half again the population. Held at 0.015. Patch count is STABLE between
      tick 10,000 and 30,000 — the structure is sustained, not a transient. */
  regen: 0.015,
  /** How much of the difference with its neighbours a field cell takes on each
      tick. Substrate spreads sideways, which does three things: it softens the
      grid so depletion reads as ground rather than as tiles, it refills a
      spoiled patch partly from its neighbours (so an isolated colony does better
      than a crowded one, with nothing written to say so), and it is the same
      pass the signal channels will need later.

      It carries more weight since regrowth went logistic: bare ground cannot
      regrow from nothing, so diffusion from the edges is the ONLY way a ruined
      patch ever comes back.

      MEASURED, and the value is small for a reason: diffusion and local scarcity
      pull against each other. At 0.09 the world is effectively well-mixed —
      substrate arrives faster than cells can deplete it, patchiness collapses
      from 8.9 to 0.24, and the ground is stripped to 0.5% everywhere. At 0.002
      the field stays strongly patchy (8.97) and healthier (11.4 of 20) while
      supporting half again as many cells as no diffusion at all. */
  diffuse: 0.002,
  /** What a cell spends per tick simply existing. Death by neglect lives here:
      stand still, spoil your patch, and this number kills you. */
  upkeep: 0.0267,
  /** The most a cell can pull out of its field cell per tick. Caps how fast a
      rich patch can be stripped, and is what makes crowding onto one good spot
      self-defeating rather than free. */
  drawRate: 0.08,
  /** Reserve a cell can hold. Buffering, so one thin tick is not instant death. */
  reserveMax: 6,
  /** Reserve a new cell starts with, as a fraction of reserveMax. */
  reserveAtBirth: 0.4,
  /** Reserve at which a cell divides, as a fraction of reserveMax. The parent
      and daughter split what the parent had. Above 1 nothing ever buds. */
  budThreshold: 0.92,

  // ---- rule 5: sensing, and the one verb that costs ----
  /* A cell reads the substrate gradient where it stands and pushes along it.
     That is chemotaxis, which is what a real single cell does with no brain at
     all. Here it is a fixed policy with a strength dial; in stage 4 the policy
     becomes a function the genome computes, and a genome is free to evolve one
     that runs DOWN the gradient and starves. Nothing knows which way is good. */

  /** Propulsion force per unit of substrate gradient. Zero = nothing moves,
      which is the control this stage is measured against.

      MEASURED, and there is a phase transition just above this. Movement raises
      the sustainable population (840 -> 1177 here, and up to ~1920 if pushed),
      but past about 20 the cells become perfect foragers: every gradient is
      found and eaten, patchiness collapses from 9 to 0.1, and the world is
      stripped uniformly bare. Held at 8, where the population gains 40% and
      patchiness is HIGHER than with no movement at all (9.19 against 8.97) —
      cells concentrating on rich ground deepens the contrast. */
  taxis: 8,
  /** Reserve spent per tick per unit of propulsion force. Movement is paid out
      of the SAME budget as existing, so searching competes with enduring and no
      penalty had to be written to make it a trade-off.

      This one matters more than its size suggests. At 3% of upkeep it barely
      shows here, but it is what stops strong taxis running away: at taxis 40 it
      is the difference between patchiness 0.32 and 5.55, and at taxis 220 it is
      the difference between a stripped world and extinction. There is a real
      OPTIMUM in movement — too little and too much both cost population — which
      is what will give this a shape to find once it becomes a gene rather than a
      ramp to run to the ceiling. */
  moveCost: 0.002,

  // ---- the run ----
  /** Hard ceiling so a runaway can't hang the tab. Not a biological limit. */
  maxCells: 4000,
  /** Cells seeded at the start, scattered in a disc of this radius. Seeded ACROSS
      the world rather than in one clump: with no way to move yet, colonisation
      spreads only as fast as budding carries a daughter 10 units at a time, and
      from one clump the world would still be mostly empty after 20,000 ticks. */
  seedCount: 60,
  seedSpread: 480,
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
