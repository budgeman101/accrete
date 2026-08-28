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
  /** How much each neighbour reduces upkeep — surface-to-volume, which is the
      classic reason for being bigger and the thing that finally makes clustering
      WORTH something here.

      Loss happens across exposed surface, and an interior cell has less of it.
      That is a statement about how loss works, not a rule about groups: it makes
      no reference to clusters or bonds, and a cell packed among strangers gets
      the same break. What makes it select for STICKINESS specifically is rule 4 —
      the current pulls loose clumps apart, so only a bonded group keeps the
      shelter it has.

      The first attempt at rule 4 failed for a reason worth keeping: shelter from
      DRAG lets a big lump hold station, and holding station is worthless in a
      world where presence spoils the ground. Rule 3 makes staying put lethal;
      that version of rule 4 rewarded it. They were fighting. */
  upkeepShelter: 0.22,
  /** What a cell spends per tick simply existing, fully exposed. Death by
      neglect lives here: stand still, spoil your patch, and this number kills
      you. */
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

  // ---- rule 4: one force whose effect depends on size ----
  /* Without this the physics is scale-invariant: being bigger buys nothing, so
     nothing ever pays for the first cluster and stickiness has no reason to
     exist. A current, not settling — settling only selected anything in the lab
     because a TRANSFER STEP did the culling, and with no transfer, sinking fast
     just means being at the bottom.

     The whole mechanism is SHELTER. A current that pushes every cell equally
     moves a cluster exactly as fast as a lone cell and changes nothing. It is
     only when interior cells are shielded that force scales with a lump's
     PERIMETER while being shared across its AREA — so big things hold station
     and small things wash off. That is what makes a good patch worth being big
     on. */

  /** Force per unit of flow speed on a fully exposed cell. Zero = no current.

      MEASURED at equilibrium over two seeds. The clustering edge grows with it —
      +5% at 70, +10% at 160, +122% at 320 — but so does the damage: patch
      structure falls from 5.3 regions to 2.9 to 2.6, and the world flattens.
      Held at 70, because s = 0.05 is already a very strong selection coefficient
      and the rest is overkill that wrecks the thing you would be watching. */
  drag: 70,
  /** How much each neighbour shelters you. Force is divided by (1 + shelter x
      crowding), so an interior cell feels almost nothing. */
  shelter: 0.55,
  /** Flow speed. The field is a divergence-free swirl from a stream function, so
      it circulates rather than sweeping everything into a corner. */
  flowSpeed: 1,
  /** Size of the swirl cells, in world units. */
  flowScale: 420,
  /** How fast the pattern drifts. NOT zero: a static flow would hand out
      permanently sheltered real estate, which is designer-supplied spatial
      structure of exactly the kind this project refuses. Drifting means holding
      station has to be earned by being big, not by being lucky. */
  flowDrift: 0.0016,

  // ---- stage 6: bonds conduct ----
  /* Fraction of the difference in reserve that flows along a bond each tick.

     THE POINT IS VARIANCE, NOT INTAKE. Sharing is zero-sum in the mean — you
     give when you are on good ground and receive when you are on bad. It pays
     because death at zero is ABSORBING: averaging with a neighbour cannot raise
     your expected intake but it can stop you hitting zero, and a fitness
     function with an irreversible floor rewards that. Insurance.

     And unlike the surface-to-volume saving, it is IMPOSSIBLE WITHOUT THE BOND.
     That was the whole failure of stage 4: shelter came free to any cell
     standing in a crowd, so nothing had to stick to get it.

     A world constant rather than a gene, deliberately: conduction is a property
     of the junction, which is what a real one is (gap junctions, plasmodesmata).
     ⚠ Making it a gene reopens the cheater question — take without giving — and
     that is a real question this design has not yet had to face.

     ⚠⚠ DEFAULTED TO ZERO, because it was measured and it LOSES. Flat conduction
     took sticky lineages from 37% of the population to 0.4%; rescue-only, which
     was supposed to fix that, still never beat sharing nothing. The mechanism is
     kept rather than deleted because it is expected to be worth revisiting once
     a mortality source exists that is not resource competition — insurance is
     worth nothing when nothing kills you except being outbred. See stage 6. */
  share: 0,
  /** Sharing is RESCUE, not equalisation, and the difference decides everything.

     Flat conduction was built first and it was catastrophic: sticky lineages fell
     from 37% to 0.4% of the population. Reproduction is threshold-gated, so
     VARIANCE IS AN ASSET — without pooling somebody is always rich enough to
     divide, and pooling flattens everyone to a mean that may sit below the
     threshold, so a cluster becomes a set of equally mediocre cells that never
     bud while loose cells bud freely. The insurance intuition was backwards.

     So material only flows to a cell BELOW this line, and only out of a partner's
     excess ABOVE it. The top of the distribution is untouched — the rich still
     get rich enough to divide — and only the tail that was about to die is
     caught. Which is what a body does: it triages, it does not equalise. */
  rescueLine: 0.3,

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
