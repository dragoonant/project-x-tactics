// Every tunable number of the syndicate AI lives here (named, in one object). Units are "damage points":
// 1.0 is roughly one point of expected Health damage dealt or taken.
export const weights = {
  // ---- tile scoring (where to stand) ----
  /** Per unit of cover (0 = open, 1 = full cover) against the troopers that can see the tile. The main factor. */
  cover: 1.6,
  /** Bonus when no trooper can see the tile at all (dark, out of line). Added on top of full cover value. */
  hidden: 0.6,
  /** Per point of expected incoming Health damage (hit chance x average damage of every trooper that sees the tile). */
  exposure: 0.9,
  /** Per trooper that would hit the tile with no cover at all (a flank on us). */
  flankedBy: 0.5,
  /** Standing on a tile with no cover piece on any side, while a trooper can see it. */
  openGround: 0.6,
  /** Standing in a gas cloud while not gas-immune (aim penalty and Resolve damage). */
  gas: 3.0,
  /** Moving onto a tile an overwatching trooper can see and shoot (a free reaction shot). */
  overwatchTile: 1.1,
  /** Per tile the nearest trooper is outside the weapon's best range band (capped at rangeOffCap). */
  rangeOff: 0.12,
  rangeOffCap: 4,
  /** Per step walked (prefers short moves when all else is equal). */
  step: 0.03,
  /** Per tile of path distance closed towards the objective when the plan is not a shot. */
  progress: 0.35,
  /** Same, for melee rushers (they close the distance harder). */
  rushProgress: 0.7,

  // ---- shot value (what to shoot) ----
  damage: 1.0,
  /** Bonus times the chance that the shot kills. */
  kill: 2.0,
  /** Bonus times (1 - hp/maxHp) of the target, times the chance to hurt it: finish wounded troopers. */
  finish: 1.2,
  /** Bonus when the target has no cover from our tile (a flank on a trooper), times the chance to hurt. */
  flankedTarget: 0.8,
  /** Bonus times target aim / 100: prefer the dangerous shooters. */
  threat: 0.8,

  // ---- plans that end the turn without a shot ----
  overwatch: 0.8,
  /** Hunker is worth this share of the unit's exposure on the tile (it doubles cover) plus a small constant. */
  hunkerExposure: 0.45,
  hunkerBase: 0.2,

  // ---- roles ----
  /** Extra value of a melee attack for a unit that charges (the Thug with a club). */
  charge: 2.5,
  /** Tile-scoring multiplier for melee rushers (they care less about cover). */
  meleeTile: 0.35,
  /** Heavy: Suppress value = base + exposure share x hit chance of its shot on the target. */
  suppressBase: 3.8,
  suppressExposure: 1.6,
  /** Penalty for suppressing a trooper that is already suppressed (by anyone). */
  suppressRepeat: 3,
  /** Enemies with Resolve at or below this retreat to cover instead of attacking. */
  lowResolve: 2,
  /** Retreating units multiply their cover, hidden and exposure weights by this. */
  lowResolveSafety: 2.2,
  /** Retreating units multiply their shot values by this. */
  lowResolveShot: 0.3,
  /** Bagman and his guards stay within this many steps of where they stand. */
  guardLeash: 3,
  /** Fixer walks to rally only to tiles whose exposure is below this. */
  fixerMaxExposure: 1.6,
  /** A last-seen ghost older than this many rounds is ignored. */
  ghostMemory: 4,
  /** Deterministic tie-break noise (seeded from the state). */
  jitter: 0.02,
}
export type Weights = typeof weights
