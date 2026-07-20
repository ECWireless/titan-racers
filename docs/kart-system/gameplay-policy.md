# Shared Gameplay Policy

## Responsibility

Gameplay policy preserves the intended game feel without masquerading as kart
construction. Policy is selected by the race ruleset and is identical for every
participating kart; a kart document cannot choose a more advantageous version.

Current policy families include:

- steering requests use 45% of the lower physical grip or rollover boundary
  and add half of the transient tire-slip demand needed to build cornering
  force; front and rear slip largely cancel in steady-state bicycle geometry,
  so a full extra axle slip angle would double-count the request;
- steering response uses one shared center-to-full duration;
- the axle trailing the direction of travel receives one mild grip-safety
  ratio so the simplified tire solver remains recoverable in forward and
  reverse;
- near-zero tire behavior uses shared crossover and settling timing;
- the sealed four-wheel service brake proportions its current request by
  measured supported-wheel load, while the handbrake retains a fixed rear-only
  split;
- grounded rest settling uses shared eligibility/timing and derives corrective
  impulse from each kart's inertia;
- grounded motion stabilization continuously damps only chassis-local roll
  whenever at least two wheels are supported, plus world-vertical heave only
  while the kart and every contacted support are nearly upright. Its shared
  0.10/0.08-second responses derive torque/linear impulse from each kart's
  inertia/mass. This deliberately suppresses finite-sweep hopping during hard
  turns and flat landings without damping pitch, yaw, ramps, single-wheel
  contact, or airborne motion;
- manual righting uses shared eligibility, clearance, timing, and contact-loss
  allowance while deriving impulses from mass and inertia; a bounded
  righting-only landing window targets upright angular velocity and performs a
  one-shot post-contact angular-momentum capture at the first upright
  four-wheel landing; and
- collision numerical damping and CCD ratios are shared solver policy.

Construction, mass distribution, geometry, suspension load, and the shared
tire/contact model still determine the physical balance. The trailing-axle
margin is identical for every kart and changes axle with travel direction; it
is not an authored balance stat or a permanent rear-tire advantage.

## Source Of Truth

- steering: `src/game/kart/kart-steering.ts`;
- tire request shaping: `src/game/kart/kart-tire-model.ts`;
- grounded settling: `src/game/kart/kart-rest-settling.ts`;
- grounded motion stabilization:
  `src/game/kart/kart-grounded-roll-damping.ts`;
- manual righting: `src/game/kart/kart-righting.ts`; and
- collision solver policy: `src/game/collision/kart-collision-model.ts`.

## Units

Policy ratios are dimensionless. Thresholds and targets use explicit SI units
or degrees/radians as documented beside each constant. Corrective impulse must
derive from the resolved kart mass or inertia so policy targets comparable
motion rather than equal raw force.

## Versioning

A policy change that can alter driving, recovery, or race outcomes creates a
new gameplay-policy version and composite competitive race ruleset. Policy
cannot be stored inside a kart revision. Pure presentation policy is versioned
separately.
