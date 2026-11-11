// Shot effects per weapon (presentation only, no rules): how many rounds a ranged attack shows, how they spread, how fast they fly and
// where each one ends. The engine resolves ONE roll per attack (hit, graze or miss); a burst only shows that roll: on a hit most rounds
// land on the target, on a graze a few clip it, on a miss every round goes past and ends in a wall, the ground or the distance.
// World coordinates (x east, z south, y up; a figure is 1.0 tall, walls 1.5). Times are wall-clock ms at Normal speed with bullet
// time on; the director scales them by its speed factor (and bullet time off makes them quicker, see SLOW).
export type V3 = [number, number, number]

/** What a round hits at the end of its flight: the target, a wall, the ground, or nothing (it flies out of view). */
export type Impact = 'flesh' | 'spark' | 'dust' | null

export interface WeaponFx {
  /** Shots fired (a burst), and the ms between them. */
  rounds: number
  gap: number
  /** Projectiles per shot (a shotgun throws a cone of pellets) and the cone half-angle in radians. */
  pellets: number
  cone: number
  /** Flight speed in world units per ms at full speed (bullet time slows it, see SLOW). */
  speed: number
  /** Streak length and thickness of a round, world units. */
  len: number
  width: number
  color: string
  /** Every nth shot is a tracer (a longer, hotter streak); 0: none. */
  tracerEvery: number
  /** Muzzle flash size (1 = rifle) and the muzzle smoke puff (0 = none). */
  flash: number
  smoke: number
  /** A faint vapour line that lingers along the flight (the suppressed long rifle). */
  trail: boolean
  /** Spread of the aim point on the target body, world units. */
  jitter: number
}

const BULLET = '#ffe6b0'
export const WEAPON_FX: Record<string, WeaponFx> = {
  pistol: { rounds: 1, gap: 0, pellets: 1, cone: 0, speed: 0.06, len: 0.32, width: 0.03, color: BULLET, tracerEvery: 0, flash: 0.8, smoke: 0.25, trail: false, jitter: 0.08 },
  revolver: { rounds: 1, gap: 0, pellets: 1, cone: 0, speed: 0.06, len: 0.4, width: 0.036, color: BULLET, tracerEvery: 0, flash: 1.3, smoke: 0.5, trail: false, jitter: 0.08 },
  rifle: { rounds: 3, gap: 95, pellets: 1, cone: 0, speed: 0.08, len: 0.45, width: 0.03, color: BULLET, tracerEvery: 3, flash: 1, smoke: 0.3, trail: false, jitter: 0.14 },
  smg: { rounds: 5, gap: 60, pellets: 1, cone: 0, speed: 0.065, len: 0.3, width: 0.026, color: BULLET, tracerEvery: 0, flash: 0.75, smoke: 0.2, trail: false, jitter: 0.2 },
  lmg: { rounds: 6, gap: 75, pellets: 1, cone: 0, speed: 0.08, len: 0.5, width: 0.034, color: BULLET, tracerEvery: 2, flash: 1.25, smoke: 0.55, trail: false, jitter: 0.24 },
  shotgun: { rounds: 1, gap: 0, pellets: 9, cone: 0.075, speed: 0.055, len: 0.16, width: 0.022, color: '#ffd28a', tracerEvery: 0, flash: 1.9, smoke: 0.9, trail: false, jitter: 0 },
  longRifle: { rounds: 1, gap: 0, pellets: 1, cone: 0, speed: 0.12, len: 0.6, width: 0.02, color: '#dfe9ff', tracerEvery: 0, flash: 0.3, smoke: 0, trail: true, jitter: 0.04 },
}
/** An unknown ranged weapon draws as a pistol. */
export const fxFor = (weapon: unknown): WeaponFx => WEAPON_FX[String(weapon)] ?? WEAPON_FX.pistol!

export const TRACER = { color: '#ff7a2a', len: 2.2, width: 1.5 }

/**
 * Bullet time: while rounds are in the air the board runs at SLOW x speed. The rounds fly slower by the same factor and the burst gap
 * stretches, so a shot reads from the muzzle to the target. `ease` is the ramp in and out (ms). Without bullet time rounds fly at full
 * speed (and the board does not slow).
 */
export const SLOW = { scale: 0.3, ease: 140, hold: 120 }

export interface Round {
  /** Shot index in the burst (pellets of one shot share it). */
  shot: number
  from: V3
  to: V3
  /** Wall ms after the volley starts that the round leaves the muzzle, and the flight time. */
  delay: number
  flight: number
  len: number
  width: number
  color: string
  tracer: boolean
  hit: boolean
  impact: Impact
}
/**
 * `shots`: wall ms of each shot (one muzzle flash each); `firstHit`: when the first round lands on the target (null: none do);
 * `end`: when the last round ends its flight; `time`: wall ms per full-speed ms (puffs and trails stretch by it too);
 * `worldFlash`: draw the muzzle flash in the effect (a figure without a rigged gun).
 */
export interface Volley { rounds: Round[]; shots: number[]; flash: number; smoke: number; trail: boolean; firstHit: number | null; end: number; time: number; worldFlash?: boolean }

/** Small deterministic RNG (mulberry32) so a replayed shot looks the same. */
export function rngFrom(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len3 = (a: V3): number => Math.hypot(a[0], a[1], a[2])

/** How many of `n` rounds land on the target for each outcome (at least one on a hit or a graze). */
export function landing(n: number, outcome: string): number {
  if (outcome === 'hit') return Math.max(1, Math.round(n * 0.7))
  if (outcome === 'graze') return Math.max(1, Math.round(n * 0.3))
  return 0
}

/**
 * Where a round that misses ends: it passes the target `side` units off the line and carries on, down to the ground, into the first
 * wall (below its 1.5 top) or out to `reach` units past the target.
 */
function missEnd(from: V3, aim: V3, side: number, lift: number, blocked: (x: number, z: number) => boolean, reach: number): { to: V3; impact: Impact } {
  const d = sub(aim, from)
  const flat = Math.hypot(d[0], d[2]) || 1
  const r = [-d[2] / flat, d[0] / flat] // right of the line of fire
  const pass: V3 = [aim[0] + r[0]! * side, aim[1] + lift, aim[2] + r[1]! * side]
  const dir = sub(pass, from)
  const L = len3(dir)
  const u: V3 = [dir[0] / L, dir[1] / L, dir[2] / L]
  const step = 0.2
  for (let s = L; s <= L + reach; s += step) {
    const p: V3 = [from[0] + u[0] * s, from[1] + u[1] * s, from[2] + u[2] * s]
    if (p[1] <= 0.02) return { to: [p[0], 0.02, p[2]], impact: 'dust' }
    if (p[1] < 1.5 && blocked(p[0], p[2])) return { to: p, impact: 'spark' }
  }
  const s = L + reach
  return { to: [from[0] + u[0] * s, from[1] + u[1] * s, from[2] + u[2] * s], impact: null }
}

/**
 * The rounds of one ranged attack from `from` (the muzzle) at `aim` (the target's chest). `slow`: bullet time (the flights and the
 * burst gaps stretch by 1 / SLOW.scale). `k`: the director's speed factor (Fast is 0.4).
 */
export function planVolley(weapon: unknown, from: V3, aim: V3, outcome: string, seed: string, blocked: (x: number, z: number) => boolean, opts: { slow: boolean; k: number }): Volley {
  const w = fxFor(weapon)
  const rnd = rngFrom(seed)
  const t = opts.k / (opts.slow ? SLOW.scale : 1) // wall ms per full-speed ms
  const n = w.rounds * w.pellets
  const lands = landing(n, outcome)
  // which rounds land: spread through the burst (the first round of a hit always lands, so the hit reads at once)
  const hits = new Set<number>()
  for (let j = 0; j < lands; j++) hits.add(Math.min(n - 1, Math.floor((j * n) / lands)))
  const rounds: Round[] = []
  const shots: number[] = []
  const d = sub(aim, from)
  const flat = Math.hypot(d[0], d[2]) || 1
  const right: [number, number] = [-d[2] / flat, d[0] / flat]
  for (let s = 0; s < w.rounds; s++) {
    const delay = s * w.gap * t
    shots.push(delay)
    const tracer = w.tracerEvery > 0 && (s + 1) % w.tracerEvery === 0
    for (let p = 0; p < w.pellets; p++) {
      const i = s * w.pellets + p
      const hit = hits.has(i)
      let to: V3, impact: Impact
      if (w.pellets > 1) {
        // a pellet: a random direction in the cone, at the target's distance; pellets on the body stop there, the rest carry on
        const ang = (rnd() * 2 - 1) * w.cone, up = (rnd() * 2 - 1) * w.cone * 0.7
        const side = Math.tan(ang) * flat, lift = Math.tan(up) * flat
        if (hit) { to = [aim[0] + right[0] * Math.max(-0.22, Math.min(0.22, side)), aim[1] + Math.max(-0.25, Math.min(0.25, lift)), aim[2] + right[1] * Math.max(-0.22, Math.min(0.22, side))]; impact = 'flesh' }
        else ({ to, impact } = missEnd(from, aim, Math.sign(side || 1) * Math.max(0.3, Math.abs(side)), lift, blocked, 2.5 + rnd() * 2))
      } else if (hit) {
        to = [aim[0] + right[0] * (rnd() * 2 - 1) * w.jitter, aim[1] + (rnd() * 2 - 1) * w.jitter, aim[2] + right[1] * (rnd() * 2 - 1) * w.jitter]
        impact = 'flesh'
      } else {
        const side = (rnd() < 0.5 ? -1 : 1) * (outcome === 'graze' ? 0.3 + rnd() * 0.2 : 0.35 + rnd() * 0.45)
        ;({ to, impact } = missEnd(from, aim, side, (rnd() * 2 - 1) * 0.35, blocked, 3 + rnd() * 3))
      }
      const flight = (len3(sub(to, from)) / w.speed) * t
      rounds.push({
        shot: s, from, to, delay, flight, hit, impact, tracer,
        len: w.len * (tracer ? TRACER.len : 1), width: w.width * (tracer ? TRACER.width : 1), color: tracer ? TRACER.color : w.color,
      })
    }
  }
  const landed = rounds.filter((r) => r.hit).map((r) => r.delay + r.flight)
  const end = Math.max(...rounds.map((r) => r.delay + r.flight))
  return { rounds, shots, flash: w.flash, smoke: w.smoke, trail: w.trail, firstHit: landed.length ? Math.min(...landed) : null, end, time: t }
}
