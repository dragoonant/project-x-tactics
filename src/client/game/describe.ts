// Human-readable telemetry lines for every engine event kind. Never prints "undefined" or "NaN".
import { WEAPONS } from '../../data'
import type { GameEvent, State } from '../../engine'
import { abilityLabel, shortName } from './names'

export type Tone = 'info' | 'hit' | 'warn' | 'alarm' | 'good' | 'phase'
export interface Line { text: string; tone: Tone }
export interface NameCtx { state: State; visible: Set<string> | null }

function num(v: unknown, fallback = '?'): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 10) / 10) : fallback
}

export function nameOf(id: unknown, ctx: NameCtx): string {
  if (typeof id !== 'string') return 'someone'
  const u = ctx.state.units.find((x) => x.id === id)
  if (!u) return 'unknown unit'
  if (u.side === 'syndicate' && ctx.visible && !ctx.visible.has(u.id)) return 'unseen contact'
  return shortName(u)
}

function weaponName(id: unknown): string {
  return typeof id === 'string' ? WEAPONS[id]?.name ?? id : 'weapon'
}

function hidden(id: unknown, ctx: NameCtx): boolean {
  if (typeof id !== 'string' || !ctx.visible) return false
  const u = ctx.state.units.find((x) => x.id === id)
  return !!u && u.side !== 'squad' && !ctx.visible.has(id)
}

const SIDE_NAME: Record<string, string> = { squad: 'SQUAD', syndicate: 'SYNDICATE', civilians: 'CIVILIAN' }

export function describeEvent(e: GameEvent, ctx: NameCtx): Line | null {
  const N = (id: unknown): string => nameOf(id, ctx)
  const L = (text: string, tone: Tone = 'info'): Line => ({ text: text.replace(/undefined|NaN/g, '?'), tone })
  switch (e.kind) {
    case 'phaseStart': return L(`${SIDE_NAME[String(e.side)] ?? 'UNKNOWN'} PHASE`, 'phase')
    case 'roundEnd': return L(`Round ${num(e.round)} closed. Alarm ${num(e.alarm)} of ${num(ctx.state.tuning.alarm.max)}`, 'phase')
    case 'phaseEnd': case 'step': case 'civilianMove': case 'noise': case 'strayRoll': return null
    case 'attackAction': return e.at ? L(`${N(e.unit)} fires at a lamp`) : null
    case 'bleed': return L(`${N(e.unit)} is bleeding out: ${num(e.left)} turn(s) left`, 'warn')
    case 'move':
      if (hidden(e.unit, ctx)) return null
      return L(`${N(e.unit)} moves ${num(e.cost)} tile(s)`)
    case 'moveInterrupted': return L(`${N(e.unit)} is halted mid-move`, 'warn')
    case 'attack': {
      const b = e.breakdown ?? {}
      const outcome = typeof e.outcome === 'string' ? e.outcome.toUpperCase() : '?'
      const via = e.via === 'attack' || e.via === undefined ? weaponName(e.weapon) : abilityLabel(String(e.via))
      const chance = b.auto ? 'auto' : `${num(b.chance)}%`
      return L(`${N(e.attacker)} fires ${via} at ${N(e.target)}: ${outcome} (${chance}, roll ${num(e.roll)})`, e.outcome === 'miss' ? 'info' : 'hit')
    }
    case 'damage': {
      const hp = typeof e.hp === 'number' ? e.hp : 0, res = typeof e.resolve === 'number' ? e.resolve : 0
      if (hp === 0 && res === 0) return null
      const cause = typeof e.cause === 'string' ? ` (${e.cause})` : ''
      return L(`${N(e.target)} takes ${num(hp)} Health, ${num(res)} Resolve${cause}. Health ${num(e.hpLeft)}, Resolve ${num(e.resolveLeft)}`, 'hit')
    }
    case 'death': return L(e.cause === 'bleedOut' ? `${N(e.unit)} bleeds out` : `${N(e.unit)} is dead`, 'alarm')
    case 'downed': return L(`${N(e.unit)} is down and bleeding`, 'alarm')
    case 'stabilized': return L(`${N(e.unit)} stabilized by ${N(e.by)}`, 'good')
    case 'surrender': return L(`${N(e.unit)} surrenders`, 'good')
    case 'cuffed': return L(`${N(e.unit)} cuffed by ${N(e.by)}`, 'good')
    case 'flee': return hidden(e.unit, ctx) ? null : L(`${N(e.unit)} bolts for the exit`, 'warn')
    case 'escaped': return L(`${N(e.unit)} escapes ${e.via === 'van' ? 'in the van' : 'through an exit'}`, 'alarm')
    case 'bagmanFlees': return L('The Bagman is running for the van', 'alarm')
    case 'cacheSeized': return L(`${nameOf(e.unit, ctx)} secures the evidence cache`, 'good')
    case 'cacheBurned': return L('The syndicate burned the evidence cache', 'alarm')
    case 'fleeBlocked': return L(`${N(e.unit)} has no way out`, 'info')
    case 'holdsSurrender': return L(`${N(e.unit)} stays down under guard`, 'info')
    case 'rally': return L(`${N(e.by)} rallies ${N(e.unit)} to Resolve ${num(e.resolve)}`, 'warn')
    case 'relay': return L(`${N(e.unit)} relays orders to ${N(e.target)}`, 'good')
    case 'bonusAction': return L(`${N(e.unit)} gains an action`, 'good')
    case 'heal': return L(`${N(e.unit)} healed ${num(e.hp)}`, 'good')
    case 'marked': return L(`${N(e.unit)} is marked by ${N(e.by)}`, 'good')
    case 'suppressed': return L(`${N(e.unit)} is suppressed by ${N(e.by)}`, 'info')
    case 'pinned': return L(`${N(e.unit)} is pinned down`, 'info')
    case 'stunned': return L(`${N(e.unit)} is stunned`, 'info')
    case 'ripple': return L(`${N(e.unit)} is shaken by what happened to ${N(e.source)}`, 'info')
    case 'panic': return L(`${N(e.unit)} panics`, 'warn')
    case 'civilianFlee': return L(`${N(e.unit)} runs for cover`, 'info')
    case 'civilianSafe': return L(`${N(e.unit)} reaches safety`, 'good')
    case 'civilianCasualty': return L(`${N(e.unit)} is killed. Order cost`, 'alarm')
    case 'alarm': return L(`ALARM ${num(e.from)} to ${num(e.to)}${typeof e.reason === 'string' ? ` (${e.reason})` : ''}`, 'alarm')
    case 'alarmThreshold': return L(`ALARM THRESHOLD ${String(e.threshold ?? '').replace(/^t/, '')} reached`, 'alarm')
    case 'groupAware': return L(`A group is alerted (${typeof e.reason === 'string' ? e.reason : 'noise'})`, 'alarm')
    case 'wave': return L(`Reinforcements arriving from the ${String(e.spawn ?? 'edge')}: wave ${String(e.wave ?? '?')}`, 'alarm')
    case 'explosion': return L('Explosion', 'warn')
    case 'gasCloud': return L(`Gas cloud released (${num(e.duration)} turns)`, 'info')
    case 'gasDamage': return hidden(e.unit, ctx) ? null : L(`${N(e.unit)} chokes on gas`, 'hit')
    case 'support': return L(`Support called: ${String(e.option ?? 'unknown')}`, 'warn')
    case 'lampShot': return L(`${N(e.attacker)} shoots out a lamp`, 'info')
    case 'lampDestroyed': return L('A lamp goes dark', 'info')
    case 'doorOpened': return L(`${N(e.by)} opens a door`, 'info')
    case 'coverChipped': return L('Cover is chipped', 'info')
    case 'coverDestroyed': return L('Cover is destroyed', 'info')
    case 'overwatchFire': return L(`${N(e.unit)} reacts with overwatch on ${N(e.target)}`, 'warn')
    case 'suppressionFire': return L(`${N(e.unit)} lays suppressing fire on ${N(e.target)}`, 'warn')
    case 'missionEnd': return L(`OPERATION ${String(e.outcome ?? '?').toUpperCase()}`, 'phase')
    case 'ability': {
      const ab = String(e.ability ?? '')
      if (!['overwatch', 'longWatch', 'hunker', 'frag', 'gas', 'stim', 'callSupport', 'suppress'].includes(ab)) return null
      const t = typeof e.target === 'string' ? ` on ${N(e.target)}` : ''
      return L(`${N(e.unit)}: ${abilityLabel(ab, typeof e.option === 'string' ? e.option : undefined)}${t}`)
    }
    default:
      return L(`${e.kind}${typeof e.unit === 'string' ? ' ' + N(e.unit) : ''}`)
  }
}
