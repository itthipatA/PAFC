# PAFC Project State

> Updated after every milestone. Read by loop-audit + session-startup.

## Current

- **Phase:** 35m (Cross-tower interference aggregation) + Loop engineering integration
- **Git commit:** c5e78a0 (latest)
- **Services:** backend=8001 (running), frontend=5173 (running), db=5432 (running)

## Engineering Status

- **Single Cell Mode:** ✅ Verified — 3GPP/ITU-R compliant
- **Polygon Mode:** ✅ Verified — Cross-tower aggregation + Gap 1+2 fixed
- **Known Limitations:** Per-tower sector antenna (Gap #3, deferred)

## Loop Engineering

- **Loop Ready:** 100/100 — L3 Production Loop
- **Pre-Commit Gate:** ✅ Active (pre-commit-gate.py + watchdog cronjob `98d0c801235d` every 30 min)
- **Understand-Anything Graph:** ✅ exists (46 nodes, 83 edges)
- **`.loop/` files:** context.md, conventions.md, pitfalls.md, state.md, config.json, loop-gate.py, pre-commit-gate.py

## Last Session

- **Date:** 2026-07-05
- **Tasks:** MapLibre crash fix → Engineering audit → Cross-tower aggr (Gap 1+2) → l1-gate harness → Senior Workflow v2.0→v2.2 → Loop engineering integration → Decision Gates
- **Key decisions:** Subagent no-memory architecture, Project-agnostic loop-gate, understand/graphify Decision Gates
