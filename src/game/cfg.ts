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

  // ---- where a fresh world starts; these are GENES, carried by the cell ----
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
  fieldSize: 28,
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
      and daughter split what the parent had, less the division cost. */
  budThreshold: 0.92,
  /** Material spent building a new cell, regardless of how big its share is.

      WITHOUT THIS, budThreshold is the degenerate dial. Dividing earlier always
      wins in the short run, so it evolved straight down to 0.11 — cells splitting
      at almost no reserve, a population spike to the cap, and extinction. Twice,
      in both conditions. A fixed overhead means dividing while poor wastes most
      of what you spend, so there is an OPTIMUM to find rather than a floor to
      race to. It is also just true: a new cell costs a membrane whatever else
      it gets. */
  divisionCost: 1.1,

  // ---- stage 5: the genome ----
  /* Four traits are now carried by the cell and inherited, not read from here.
     The values below are only where a seeded world STARTS.

     This is a scalar genome, and the doc is owed the real one: genes should be
     functions of sensed state computed by an unbounded graph, not a fixed list
     of dials — a fixed list is the very trap this project was started over. It
     is staged this way because a scalar genome is the smallest thing that can
     answer the central question, and answering that is what the project is for. */

  /** Standard deviation of the additive mutation on stickiness, which lives in
      [0,1]. ADDITIVE, not multiplicative: a proportion that starts at zero can
      never leave zero under a multiplicative step, and a world seeded
      unicellular could then never discover adhesion at all. */
  mutStickiness: 0.035,
  /** Log-normal spread for the ratio-valued genes. Multiplicative, so that a
      halving and a doubling are the same size of change. */
  mutRatio: 0.07,

  // ---- the ablation ----
  /* Switch dimension 1 OFF: the world stops keeping WHERE anything was done. The
     field's total is redistributed evenly across every cell each tick, so the
     world still remembers how much was taken but not from where. Uniform, and
     still scarce.

     ⚠ The first version of this ablation REFILLED the field to full each tick,
     and that was wrong: it removed scarcity along with the structure, making the
     resource infinite. The population promptly ran to the array cap and nothing
     excluded anything, because competitive exclusion needs a LIMITING resource.
     Two things ablated at once, and an uninterpretable result. Well-mixing is
     what the derivation actually specifies — `E(x)` constant in space.

     This is not a strawman of the sims this project responds to — structurally
     it IS them. A uniform, instantly-replenishing, memoryless environment is the
     implicit world of Conway's Life, Lenia and Particle Life alike. Cloning one
     of those faithfully is impossible anyway: they have no consumption for a
     world to remember and no heredity to select on, so the dimension has nowhere
     to attach. Ablating our own gives the same control for one variable, on one
     substrate, and the ablated version is the baseline. */
  wellMixedWorld: false,

  // ---- the run ----
  /** Hard ceiling so a runaway can't hang the tab. Not a biological limit. */
  maxCells: 4000,
  /** Cells seeded at the start, scattered in a disc of this radius.

      SEEDED ACROSS THE WHOLE WORLD, and this matters more than it looks. Started
      from a clump, the run spends tens of thousands of ticks COLONISING, and
      every measurement taken during that is a measurement of colonisation rather
      than of the ecology. It bit: "does stickiness pay" came out YES at 14,000
      ticks and NO at 9,000, because neither was near equilibrium. Seeding
      everywhere deletes the transient and lets a run settle in a few thousand. */
  seedCount: 200,
  seedSpread: 400,
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
