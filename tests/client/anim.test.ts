import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLIPS, EMPTY_HAND_CLIPS, FALLBACK, LOOPING, parseAnimManifest, poseFallback, resolveClip, visibleAttachments, type ClipName } from '../../src/client/anim/contract'
import { CLIP_SOURCES, abilityClip, aimsFirst, attackClip, baseClip, damageClip, hasCoverNear, moveMode } from '../../src/client/anim/mapping'
import { cueActive, playCue, startCue, cues } from '../../src/client/anim/cues'

// The canonical clip list of docs/spec/30-figures-anim.md section 2, written out so a spec change breaks this test on purpose.
const SPEC_CLIPS = ['idle', 'cover', 'walk', 'run', 'aim', 'fire', 'melee', 'bash', 'throw', 'point', 'hit', 'downed', 'surrender', 'cuffed', 'death', 'panic', 'cower']

describe('contract: clip names and fallbacks', () => {
  it('knows exactly the canonical clips, each with a documented source', () => {
    expect([...CLIPS]).toEqual(SPEC_CLIPS)
    expect(Object.keys(CLIP_SOURCES).sort()).toEqual([...SPEC_CLIPS].sort())
    expect(Object.keys(FALLBACK).sort()).toEqual([...SPEC_CLIPS].sort())
  })

  it('loops exactly the looping clips of the contract table', () => {
    expect([...LOOPING].sort()).toEqual(['cover', 'cower', 'cuffed', 'downed', 'idle', 'panic', 'run', 'surrender', 'walk'].sort())
  })

  // spec: "A missing clip falls back to idle (and run -> walk, cover -> idle, panic -> run, cower -> idle), never to a T-pose."
  const SPEC_FALLBACKS: [ClipName, string[], ClipName][] = [
    ['run', ['idle', 'walk'], 'walk'],
    ['run', ['idle'], 'idle'],
    ['cover', ['idle'], 'idle'],
    ['panic', ['idle', 'run', 'walk'], 'run'],
    ['panic', ['idle', 'walk'], 'walk'],
    ['panic', ['idle'], 'idle'],
    ['cower', ['idle', 'panic'], 'idle'],
    ['walk', ['idle'], 'idle'],
    ['bash', ['idle', 'melee', 'fire'], 'melee'],
    ['death', ['idle', 'downed'], 'downed'],
  ]
  it.each(SPEC_FALLBACKS)('missing %s with %j available plays %s', (want, have, expected) => {
    expect(resolveClip(want, (c) => have.includes(c))).toBe(expected)
  })

  it.each(SPEC_CLIPS as ClipName[])('every clip resolves to something playable: %s', (want) => {
    // a figure that has only idle never gets a T-pose; a figure with the clip plays it; a figure with nothing gets null (static model used)
    expect(resolveClip(want, (c) => c === 'idle')).toBe('idle')
    expect(resolveClip(want, (c) => c === want || c === 'idle')).toBe(want)
    expect(resolveClip(want, () => false)).toBeNull()
  })

  it('lying and kneeling poses stand in for missing death, downed, surrender and cuffed clips only', () => {
    expect(poseFallback('death', 'idle')).toBe('lying')
    expect(poseFallback('downed', 'idle')).toBe('lying')
    expect(poseFallback('surrender', 'idle')).toBe('kneel')
    expect(poseFallback('cuffed', 'surrender')).toBe('kneel')
    expect(poseFallback('death', 'death')).toBe('none')
    expect(poseFallback('walk', 'idle')).toBe('none')
  })
})

describe('contract: item swaps (spec 30 section 3)', () => {
  const bulwark = [{ id: 'revolver', bone: 'hand_r' }, { id: 'maul', bone: 'hand_r' }, { id: 'riot-shield', bone: 'lowerarm_l' }]
  it('Bulwark: revolver and shield normally, maul replaces the revolver for melee and bash', () => {
    for (const c of [null, 'idle', 'fire', 'walk'] as (ClipName | null)[]) expect(visibleAttachments(bulwark, c)).toEqual([true, false, true])
    for (const c of ['melee', 'bash'] as ClipName[]) expect(visibleAttachments(bulwark, c)).toEqual([false, true, true])
  })
  it('Vox handset shows only during point', () => {
    const vox = [{ id: 'shotgun', bone: 'hand_r' }, { id: 'handset', bone: 'hand_l' }]
    expect(visibleAttachments(vox, 'idle')).toEqual([true, false])
    expect(visibleAttachments(vox, 'point')).toEqual([true, true])
  })
  it('a figure without swap items keeps every item in every clip posed with a grip', () => {
    const recon = [{ id: 'pistol', bone: 'hand_r' }, { id: 'baton', bone: 'hand_l' }]
    for (const c of CLIPS.filter((x) => !EMPTY_HAND_CLIPS.has(x))) expect(visibleAttachments(recon, c).every(Boolean)).toBe(true)
  })
  it('surrender, cuffed, downed and cower hide every held item (the poses have empty hands)', () => {
    const bagman = [{ id: 'pistol', bone: 'hand_r' }, { id: 'case', bone: 'hand_l' }]
    for (const c of ['surrender', 'cuffed', 'downed', 'cower'] as ClipName[]) expect(visibleAttachments(bagman, c)).toEqual([false, false])
    expect(visibleAttachments(bagman, 'run')).toEqual([true, true])
  })
})

describe('mapping: engine events and state to clips', () => {
  const trooper = { side: 'squad', status: 'active', armed: true, hunkered: false }
  const BASE: [string, Parameters<typeof baseClip>[0], { cover: boolean; moving: 'walk' | 'run' | 'panic' | null }, ClipName][] = [
    ['standing in the open', trooper, { cover: false, moving: null }, 'idle'],
    ['standing with cover on any side', trooper, { cover: true, moving: null }, 'cover'],
    ['hunkered in the open', { ...trooper, hunkered: true }, { cover: false, moving: null }, 'cover'],
    ['moving (walk)', trooper, { cover: true, moving: 'walk' }, 'walk'],
    ['moving (run)', trooper, { cover: false, moving: 'run' }, 'run'],
    ['downed trooper', { ...trooper, status: 'downed' }, { cover: true, moving: null }, 'downed'],
    ['stabilized trooper', { ...trooper, status: 'stabilized' }, { cover: false, moving: null }, 'downed'],
    ['dead', { ...trooper, status: 'dead' }, { cover: false, moving: null }, 'death'],
    ['surrendered syndicate', { side: 'syndicate', status: 'surrendered' }, { cover: true, moving: null }, 'surrender'],
    ['cuffed syndicate', { side: 'syndicate', status: 'cuffed' }, { cover: false, moving: null }, 'cuffed'],
    ['calm civilian', { side: 'civilians', status: 'active', panicked: false }, { cover: true, moving: null }, 'idle'],
    ['panicked civilian standing', { side: 'civilians', status: 'active', panicked: true }, { cover: false, moving: null }, 'cower'],
    ['fleeing civilian standing', { side: 'civilians', status: 'active', fleeing: true }, { cover: false, moving: null }, 'cower'],
    ['panicked civilian moving', { side: 'civilians', status: 'active', panicked: true }, { cover: false, moving: 'panic' }, 'panic'],
    ['dead civilian', { side: 'civilians', status: 'dead' }, { cover: false, moving: null }, 'death'],
  ]
  it.each(BASE)('state: %s', (_n, u, o, expected) => { expect(baseClip(u, o)).toBe(expected) })

  it('movement: first action walks, second action (dash) and flight run, panicked civilians panic', () => {
    expect(moveMode('move', trooper, 2)).toBe('walk')
    expect(moveMode('move', trooper, 1)).toBe('run')
    expect(moveMode('flee', { side: 'syndicate', status: 'active' }, 2)).toBe('run')
    expect(moveMode('civilianFlee', { side: 'civilians', status: 'active' }, 2)).toBe('panic')
    expect(moveMode('civilianMove', { side: 'civilians', status: 'active', panicked: false }, 2)).toBe('walk')
    expect(moveMode('civilianMove', { side: 'civilians', status: 'active', panicked: true }, 2)).toBe('panic')
  })

  it('attacks: ranged fires (after aiming), melee swings, the shield bash bashes', () => {
    expect(attackClip({ via: 'attack', breakdown: { melee: false } })).toBe('fire')
    expect(attackClip({ via: 'overwatch' })).toBe('fire')
    expect(attackClip({ via: 'suppressionFire' })).toBe('fire')
    expect(attackClip({ via: 'pinningShot' })).toBe('fire')
    expect(attackClip({ via: 'breach' })).toBe('fire')
    expect(attackClip({ via: 'maul', breakdown: { melee: true } })).toBe('melee')
    expect(attackClip({ via: 'baton', breakdown: { melee: true } })).toBe('melee')
    expect(attackClip({ via: 'attack', breakdown: { melee: true } })).toBe('melee')
    expect(attackClip({ via: 'shieldBash', breakdown: { melee: true } })).toBe('bash')
    expect(aimsFirst('fire')).toBe(true)
    expect(aimsFirst('melee')).toBe(false)
    expect(aimsFirst('bash')).toBe(false)
  })

  it('abilities: relay, mark, call support and rally point; frag and gas throw; suppress fires; the rest have no clip of their own', () => {
    for (const a of ['relay', 'mark', 'callSupport', 'rally']) expect(abilityClip(a)).toBe('point')
    for (const a of ['frag', 'gas']) expect(abilityClip(a)).toBe('throw')
    expect(abilityClip('suppress')).toBe('fire')
    expect(abilityClip('takedown')).toBe('melee')
    for (const a of ['overwatch', 'hunker', 'cuff', 'stabilize', 'stim', 'breach', 'shieldBash', 'maul', 'baton', 'pinningShot']) expect(abilityClip(a)).toBeNull()
  })

  it('damage: Health loss plays hit (graze too); a Resolve-only hit does not', () => {
    expect(damageClip({ hp: 2, resolve: 0 })).toBe('hit')
    expect(damageClip({ hp: 1 })).toBe('hit')
    expect(damageClip({ hp: 0, resolve: 3 })).toBeNull()
    expect(damageClip({})).toBeNull()
  })

  it('every clip of the contract has a source in the table above or the helpers (nothing is orphaned)', () => {
    const reachable = new Set<string>(['idle', 'cover', 'walk', 'run', 'panic', 'cower', 'downed', 'surrender', 'cuffed', 'death'])
    for (const e of [{ via: 'attack' }, { via: 'shieldBash' }, { via: 'maul', breakdown: { melee: true } }]) reachable.add(attackClip(e))
    reachable.add('aim') // played before every ranged fire
    for (const a of ['relay', 'frag']) reachable.add(abilityClip(a)!)
    reachable.add(damageClip({ hp: 1 })!)
    expect([...reachable].sort()).toEqual([...SPEC_CLIPS].sort())
  })

  it('cover: a wall, closed door, cover object or rubble on any side counts', () => {
    const grid = (m: Record<string, { k: string; o?: string; open?: boolean }>) => (x: number, y: number) => m[`${x},${y}`]
    expect(hasCoverNear(grid({}), 5, 5)).toBe(false)
    expect(hasCoverNear(grid({ '5,4': { k: 'wall' } }), 5, 5)).toBe(true)
    expect(hasCoverNear(grid({ '6,5': { k: 'door', open: false } }), 5, 5)).toBe(true)
    expect(hasCoverNear(grid({ '6,5': { k: 'door', open: true } }), 5, 5)).toBe(false)
    expect(hasCoverNear(grid({ '4,5': { k: 'floor', o: 'halfCover' } }), 5, 5)).toBe(true)
    expect(hasCoverNear(grid({ '5,6': { k: 'floor', o: 'rubble' } }), 5, 5)).toBe(true)
    expect(hasCoverNear(grid({ '5,6': { k: 'floor', o: 'lamp' } }), 5, 5)).toBe(false)
    expect(hasCoverNear(grid({ '6,6': { k: 'wall' } }), 5, 5)).toBe(false) // diagonals do not count
  })
})

describe('cues', () => {
  it('a cue the rig never picked up survives a slow frame, then starts its own clock', () => {
    cues.clear()
    playCue('u1', 'aim', 100, 1)
    const c = cues.get('u1')!
    const t = c.t0
    expect(cueActive('u1', t + 50)).toBe(c)
    expect(cueActive('u1', t + 900)).toBe(c) // past its end but never started
    expect(cueActive('u1', t + 5000)).toBeNull()
    startCue(c, t + 900)
    expect(cueActive('u1', t + 950)).toBe(c)
    expect(cueActive('u1', t + 1100)).toBeNull()
    cues.clear()
  })
})

describe('anim manifest reader', () => {
  const base = 'http://localhost/app/assets/anim/manifest.json'
  it('reads the shipped manifest (the A0 Enforcer, or whatever A1 replaced it with)', () => {
    const json = JSON.parse(readFileSync('public/assets/anim/manifest.json', 'utf8'))
    const m = parseAnimManifest(json, base)
    expect(m.figures.size).toBeGreaterThan(0)
    for (const f of m.figures.values()) {
      expect(f.url.startsWith('http://localhost/app/assets/anim/')).toBe(true)
      expect(f.clips.idle).toBeDefined()
      for (const name of Object.keys(f.clips)) expect(SPEC_CLIPS, `${f.kind}: unknown clip ${name}`).toContain(name)
      for (const a of f.attachments) {
        expect(a.matrix).toHaveLength(16)
        expect(m.items.has(a.id), `${f.kind}: attachment ${a.id} has no item`).toBe(true)
      }
    }
  })

  it('resolves files relative to the manifest and accepts the Artifact packing', () => {
    const m = parseAnimManifest({
      figures: { enforcer: { file: 'enforcer.gltf.json', height: 1.8, clips: { idle: { duration: 1, loop: true }, walk: { duration: 1.3, loop: true, speed: 0.5 } }, attachments: [{ id: 'shotgun', bone: 'hand_r', matrix: new Array(16).fill(0), muzzle: [0, 1, 2] }] } },
      items: { shotgun: { file: 'items/shotgun.gltf.json' } },
    }, base)
    expect(m.figures.get('enforcer')!.url).toBe('http://localhost/app/assets/anim/enforcer.gltf.json')
    expect(m.figures.get('enforcer')!.clips.walk!.speed).toBe(0.5)
    expect(m.figures.get('enforcer')!.attachments[0]!.muzzle).toEqual([0, 1, 2])
    expect(m.items.get('shotgun')).toBe('http://localhost/app/assets/anim/items/shotgun.gltf.json')
  })

  it('normalises kind keys like the static manifest and skips junk without throwing', () => {
    const m = parseAnimManifest({ figures: { 'vox-operator': { file: 'vox.glb' }, bad: { file: 'readme.txt' }, worse: 3, alsoBad: { file: 'x.glb', clips: { idle: { duration: -1 } }, attachments: [{ id: 'a', bone: 'b', matrix: [1] }] } }, items: { x: 4, y: { file: 'y.glb' } } }, base)
    expect([...m.figures.keys()].sort()).toEqual(['alsobad', 'vox'])
    expect(m.figures.get('alsobad')!.clips).toEqual({})
    expect(m.figures.get('alsobad')!.attachments).toEqual([])
    expect([...m.items.keys()]).toEqual(['y'])
    for (const junk of [null, undefined, 3, 'x', [], { figures: 5 }]) expect(parseAnimManifest(junk, base).figures.size).toBe(0)
  })
})

describe('anim sources obey the client rules', () => {
  const files = readdirSync('src/client/anim').filter((f) => /\.tsx?$/.test(f)).map((f) => join('src/client/anim', f))
  it('rule 25: no pointer handlers on figures, attachments or effects; every item and flash is raycast-proof', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(/\bon(Pointer\w*|Click|DoubleClick|ContextMenu)\s*=/.test(src), f).toBe(false)
    }
    const rig = readFileSync('src/client/anim/Rig.tsx', 'utf8')
    expect(rig).toMatch(/o\.raycast = noRay/)
    expect(rig).toMatch(/flash\.raycast = noRay/)
  })
  it('rule 8: no native tooltips', () => {
    for (const f of files) expect(/\btitle=|<title>/.test(readFileSync(f, 'utf8')), f).toBe(false)
  })
})
