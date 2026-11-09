# project-x: agent orientation

An original turn-based squad tactics browser game (XCOM-like). Tactical prototype, one map ("Night Market"). Stack: Vite, React, TypeScript (strict), Vitest, Playwright; three.js / React Three Fiber arrive in M2.

## Where things are
- `docs/GAME-DESIGN.md` is the game design. `docs/PROTOTYPE-PLAN.md` is the prototype plan (stat sheets in section 6, map in section 8, milestones in section 10).
- `docs/spec/10-rules.md` is **the spec**. Rule ids (ARCH-1, TURN-3, LOS-3 ...), every number is a key in `src/data/tuning.json`, ambiguities are logged in its section 21 as `R-n | rule | what we did | why`. Where spec and plan disagree, the spec wins.
- `docs/status/` has milestone reports (`M1-REPORT.md`) and screenshots. `STATUS.md` says what exists and what is next.
- `src/engine/` the pure rules engine, `src/data/` JSON data and schemas, `src/debug/` the M1 debug page, `tools/` sim, fuzz and data validation, `tests/` Vitest suites.

## Engine contract (spec section 0)
- `createGame(setup)`, `step(state, action)` (pure, never throws, `{ ok: false, reason }` for illegal actions), `legalActions(state)` (never empty while the game runs; `endPhase` is always legal), `view(state, side)` (fog), `query.*` (every number a UI shows), `serialize` / `deserialize`.
- State is plain JSON (no classes, Maps, Sets, functions, `undefined`). RNG is sfc32 and lives in `state.rng`. Every roll emits an event with its breakdown. `state.log` is the accepted action list.
- The engine never hard-codes a rules number: read it with `tn(state, 'cover.half')`. `npm run validate:data` checks that every key the engine reads exists.
- No DOM, three.js or React inside `src/engine/`. UIs never do rules maths: they show `query.*` results.

## Rules for changes
- Tests are named by rule id (`it('HIT-3 graze band: ...')`). `tests/engine/coverage.test.ts` fails if a spec rule id appears in no test name. Add a test with the id when you add or change a rule; add an `R-n` ruling to spec section 21 when you pick a reading.
- Balance changes need a `npm run sim` result. Gates before a commit: `npm run typecheck`, `npm test`, `npm run validate:data`, `npm run sim -- --games 200`, `npm run fuzz -- --steps 20000`, `npm run build`.
- Never use the banned figure-prompt words in any image prompt, template or brief (see the global instructions).

## Privacy
Credit the owner only as **evilgouki**. Never write a real name, the Windows username or a home path (`C:\Users\<name>\...`) into files, commits or published artifacts; use `~`, `%USERPROFILE%` or relative paths. Before committing run `git diff --cached | grep -iE "<real name>|<username>"` and expect no output.

## Commits
Imperative one-line subject (`M1: ...`, `Engine: ...`, `Docs: ...`), optional body, then a blank line and the Co-Authored-By trailer given by the session. Commit only your own paths: `git add <paths>` then `git commit -m "..." -- <paths>`. Local-only repo on `main`, no remote.

## Commands
`npm run dev` (debug page), `npm test`, `npm run typecheck`, `npm run validate:data`, `npm run sim -- --games 200 [--seed 1] [--squad 4]`, `npm run fuzz -- --steps 20000`, `npm run build`, `npm run e2e` (Playwright, port from `PW_PORT`, default 5281).
