# PAFC Pitfalls — Single Source of Truth

> 102 known pitfalls. Inject into ALL subagent contexts.
> Full details in pafc-project skill (devops/pafc-project/SKILL.md)

## Critical Pitfalls (CRASH-LEVEL)

| # | Pitfall | Symptom | Fix |
|---|---------|---------|-----|
| 102 | MapLibre addSource without isStyleLoaded() | "Style is not done loading" crash | Guard ALL addSource with `if (!map.isStyleLoaded()) return` |
| 83 | coverage_pct fraction vs percent | Infinite retries, 79 towers for 200m polygon | `coverage_pct < 0.90` not `< 90` |
| 72 | useEffect [] closure captures stale props | Event handlers use initial values forever | Ref pattern: `const propRef = useRef(prop)` |
| 65 | Duplicate source IDs from Senior+Junior | MapLibre "Source already exists" | One author per rendering concern |
| 77 | PairResult.interferer (wrong attr) | 500 Internal Server Error | Use `pr.pair.interferer_name` |

## Common Pitfalls (FREQUENT)

| # | Pitfall | Symptom | Fix |
|---|---------|---------|-----|
| 1 | fetch() vs fetchWithAuth() | 401 silent | Always use fetchWithAuth() |
| 2 | bcrypt 5.x breaks passlib | Startup crash | Pin `bcrypt<5.0` (4.3.0) |
| 3 | greenlet missing for SQLAlchemy async | ValueError | Install greenlet |
| 4 | Map click-to-place | Site placed unintentionally | clickMode='pan' default |
| 5 | Emoji in code | User rejection | Lucide React only |
| 7 | Spectrum blocks not saved | Blocks disappear | MUST save to spectrum_blocks table |
| 9 | EIRP double-count | Wrong interference | EIRP already includes BS antenna gain |
| 10 | Backend code without restart | Stale API response | kill uvicorn → restart → curl test |
| 23 | Animation wrapper breaks flex | Map = 0px height | Pass `flex-1` className |
| 25 | Literal \n in JSX from subagents | \n visible on page | grep `\\\\n` after subagent |
| 28 | flyTo without workspace padding | Map centers under panel | `padding: {right: width*0.6}` |
| 37 | flyTo padding:undefined | isPaddingEqual TypeError | Never pass undefined padding |
| 50 | Coordination zone opacity 0.08 | Invisible red zone | Increase to 0.15-0.20 |
| 52 | coverageInfo stale cache | Wrong EIRP on save | Clear on radius/model change |
| 97 | RF radius > geo radius | 1 tower for small polygon | `cell_radius = min(rf, geo)` |

## Subagent-Specific Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Literal \n in JSX | Visible backslash-n in DOM | grep `\\\\n` after every subagent |
| Button size prop | 7+ tsc errors | No size prop on Button component |
| npm -D removes production deps | React/maplibre missing | Verify `ls node_modules/react` |
| Subagent writes duplicate code | Source ID collision | One rendering concern per author |

## Verification Commands

```bash
# Frontend
cd /Volumes/New\ Volume/coding/PAFC/frontend
npx tsc --noEmit          # TypeScript
npm run build              # Vite build
grep -r '\\\\n' src/      # Literal \n check
grep -r '[⚠️✅❌🔴🟢📍🔍📡]' src/  # Emoji check

# Backend
cd /Volumes/New\ Volume/coding/PAFC/backend
.venv/bin/python -c "import app.services.interference"  # Import check
lsof -ti:8001 | xargs kill -9 && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8001 &  # Restart
curl http://localhost:8001/api/health  # Health check
```

> **Full 102 pitfalls:** See `pafc-project` skill (`skill_view('pafc-project')`)
