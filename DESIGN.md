---
version: alpha
name: PAFC (Private Automated Frequency Coordinator)
migration_status: partial
contexts:
  login:
    colors:
      bg: "#1A1A2E"
      surface: "#162447"
      on-surface: "#FFFFFF"
  dashboard:
    colors:
      bg: "#F5F5F0"
      surface-container: "#FFFFFF"
  workspace:
    colors:
      bg: "#F5F5F0"
colors:
  primary: "#C00000"
  primary-container: "#FFDAD6"
  on-primary: "#FFFFFF"
  secondary: "#1A1A2E"
  secondary-container: "#4A4A5E"
  on-secondary-container: "#FFFFFF"
  surface: "#F5F5F0"
  surface-container: "#FFFFFF"
  on-surface: "#333333"
  on-surface-variant: "#666666"
  outline: "#CCCCCC"
  error: "#BA1A1A"
  success: "#2E7D32"
  warning: "#F57F17"
  fs-zone-blue: "#1565C0"
  fs-zone-amber: "#E65100"
  fs-zone-red: "#C62828"
  spectrum-green: "#2E7D32"
  spectrum-red: "#C62828"
  spectrum-orange: "#E65100"
typography:
  heading:
    fontFamily: TH Sarabun New
    fontSize: 1.5rem
    fontWeight: "700"
  body-md:
    fontFamily: TH Sarabun New
    fontSize: 1rem
    fontWeight: "400"
    lineHeight: 1.6
  label-md:
    fontFamily: TH Sarabun New
    fontSize: 0.9rem
    fontWeight: "600"
  label-sm:
    fontFamily: TH Sarabun New
    fontSize: 0.85rem
    fontWeight: "500"
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: "400"
rounded:
  sm: 4px
  md: 8px
  lg: 12px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  button-secondary:
    backgroundColor: "{colors.secondary-container}"
    textColor: "{colors.on-secondary-container}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
  card-surface:
    backgroundColor: "{colors.surface-container}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
  spectrum-block-available:
    backgroundColor: "{colors.spectrum-green}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
  spectrum-block-blocked:
    backgroundColor: "{colors.spectrum-red}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
  spectrum-block-warning:
    backgroundColor: "{colors.spectrum-orange}"
    textColor: "#000000"
    rounded: "{rounded.sm}"
  input-field:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
---
## Overview

PAFC (Private Automated Frequency Coordinator) — spectrum coordination tool for 4800-4990 MHz band under Thailand's NBTC regulation. The UI serves two primary contexts:

**Login:** Diagonal split layout with dark navy (#1A1A2E) background — institutional, secure, official. NBTC red logo area, clean white form on dark surface.

**Dashboard:** Light map-centric interface (warm off-white #F5F5F0). MapLibre GL map as the hero element, with side panels and modals. Thai text throughout.

**Workspace:** Slide-in panel for IMT allocation workflow — spectrum block grid, polygon upload, save/clear actions.

**Brand personality:** Government, authoritative, clean, professional. Zero decoration. No emoji. No gradients. No glassmorphism.

## Colors

- **Primary (#C00000):** NBTC institutional red — headers, primary actions, active states. Used sparingly.
- **Secondary (#1A1A2E):** Dark navy — login background, navigation, secondary information.
- **Surface (#F5F5F0):** Warm off-white — main dashboard background, softer than pure white.
- **Spectrum Green (#2E7D32):** Available frequency block indicator.
- **Spectrum Red (#C62828):** Blocked frequency block indicator.
- **Spectrum Orange (#E65100):** Warning/partial availability indicator.
- **FS Zone Blue (#1565C0):** Fixed Service Fresnel zone visualization on map.

## Typography

**Sarabun** for all UI text (Thai and English). **JetBrains Mono** for technical data (coordinates, frequencies, dB values).

## Layout & Spacing

- Login: Diagonal split (40/60 or 50/50), dark navy left, white form right
- Dashboard: Full-screen map with overlay panels, generous spacing
- Workspace: Slide-in right panel, fixed width, scrollable content
- 8px spacing grid
- Map uses pan-only mode (clickMode='pan', grab cursor)

## Shapes

Moderate rounded corners (4-8px for UI elements, 12px for cards). Spectrum blocks use sharp borders (border: 1px solid #000).

## Components

- **Buttons:** Primary = filled red, Secondary = filled gray. No ghost/outline variants needed.
- **Spectrum Blocks:** 19 blocks (4800-4990 MHz, 10 MHz each), color-coded grid. Black border always.
- **Map:** MapLibre GL, FS zone visualization, IMT polygon overlay.
- **Cards:** White surface on warm background, subtile shadows.

## Gridgeist Constitution (v1.0 — 2026-07-19)

> **Gridgeist = grid-first design methodology for product-native interfaces.**

### Thesis

> "An operational workspace for Thai spectrum regulators built on aligned data tracks, compressed hierarchy, and real frequency allocation states."

**Audience:** Thai spectrum regulators (NBTC), RF engineers
**Primary Task:** Allocate 4800-4990 MHz band — coordinate FS links + IMT stations
**Structural Logic:** Rational grid (Swiss/International adaptation for government)
**Brand Expression:** Precise, restrained, authoritative — NBTC institutional
**Product-Native Motif:** Spectrum blocks, frequency allocation states, FS coverage zones

### Surface Adaptation (Data/Technical Product)

| Dimension | Gridgeist Rule | PAFC Implementation |
|-----------|---------------|---------------------|
| **Visual Lead** | Real data, state, relationships, product UI | Spectrum blocks + map as hero |
| **Structure** | Explicit tracks, dense alignment, quiet rules | 3-track layout: Sidebar→Map→Panel |
| **Labels** | Precise, no decoration | Thai labels, JetBrains Mono for data |
| **Avoid** | Fake metrics, decorative cards, interchangeable dashboards | No KPI cards, no abstract illustrations |

### Grid System

```
┌────┬────────────────────────────────┬──────────────┐
│  S │                                │    Panel     │
│  I │          MAP AREA              │   (40%)      │
│  D │       (flex-1, hero)           │   slide      │
│  E │                                │   drawer     │
│  B │                                │              │
│  A │                                │              │
│  R │                                │              │
│ 56 │                                │              │
│ px │                                │              │
└────┴────────────────────────────────┴──────────────┘
```

| Element | Value |
|---------|-------|
| Base grid unit | 8px |
| Sidebar width | 56px (icons only) |
| Panel width | 40% (min 400px, contextual drawer) |
| Gutters | 16px between tracks |
| Grid visibility | **Quiet** — alignment rules, no visible grid lines |
| Map padding | 0 (full bleed within track) |

### Typography System (Gridgeist)

| Role | Font | Size | Weight | Usage |
|------|------|------|--------|-------|
| Display | TH Sarabun New | 2rem | 700 | Page titles (rare) |
| Heading | TH Sarabun New | 1.25rem | 700 | Section headers |
| Body | TH Sarabun New | 1rem | 400 | All UI text, labels, explanations |
| Label | TH Sarabun New | 0.875rem | 600 | Form labels, button text |
| Caption | TH Sarabun New | 0.75rem | 400 | Metadata, timestamps |
| Data | JetBrains Mono | 0.8125rem | 400 | Coordinates, dB, MHz, distances |

### Spacing Rhythm (8px base)

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 8px | Icon padding, tight gaps |
| `--space-2` | 16px | Component gaps, form spacing |
| `--space-3` | 24px | Section separation |
| `--space-4` | 32px | Major layout breaks |
| `--space-5` | 48px | Page-level breathing room |

### Shape & Surface System

| Element | Radius | Border | Shadow |
|---------|--------|--------|--------|
| Sidebar items | 8px | none | none |
| Cards/panels | 8px | 1px solid #E5E5E0 | 0 1px 3px rgba(0,0,0,0.08) |
| Input fields | 6px | 1px solid #CCCCCC | none (focus: 0 0 0 2px rgba(192,0,0,0.2)) |
| Spectrum blocks | 4px | 1px solid #000 | none |
| Buttons | 8px | none | none |
| Map controls | 4px | none | 0 1px 4px rgba(0,0,0,0.15) |

### Motion System (Gridgeist — causality only)

| Trigger | Duration | Easing | Purpose |
|---------|----------|--------|---------|
| Panel slide in/out | 300ms | cubic-bezier(0.16,1,0.3,1) | Spatial relationship |
| Tab switch | 150ms | ease-out | State change feedback |
| Map marker drop | 400ms | cubic-bezier(0.34,1.56,0.64,1) | Causality |
| Hover states | 150ms | ease | Interactive feedback |
| **No:** ambient motion, decorative animations, loading spinners >2s |

### State Inventory (Gridgeist — mandatory)

Every interactive surface MUST handle:

| State | Sidebar | Panel | Map | Form |
|-------|---------|-------|-----|------|
| Default | ✅ | ✅ | ✅ | ✅ |
| Active/Selected | ✅ | ✅ | — | — |
| Hover | ✅ | ✅ | ✅ | ✅ |
| Focus | ✅ | ✅ | — | ✅ |
| Disabled | ✅ | ✅ | — | ✅ |
| Loading | — | ✅ | ✅ | ✅ |
| Empty | — | ✅ | — | — |
| Error | — | ✅ | — | ✅ |
| Success | — | ✅ | — | — |

### Anti-Slop Contract (Gridgeist)

- ✅ Use ONE thesis and ONE coherent system
- ✅ Build hierarchy through scale, position, density, rhythm
- ✅ Prefer authentic product evidence (spectrum blocks, FS zones, allocation states)
- ✅ Give sections distinct compositions within shared structural logic
- ❌ No repeated rounded cards, centered hero copy, gradient blobs
- ❌ No excessive pills, uniform sections, arbitrary icon boxes
- ❌ No generic claims, no technical chrome for decoration
- ❌ No importing a house aesthetic — THIS is NBTC government

### Design Decision Reference

| When deciding... | Consult |
|-----------------|---------|
| Structure | Information order, task flow, shared alignments |
| Type | Brand voice (NBTC), reading needs, role hierarchy |
| Visual lead | Map + spectrum blocks — product UI leads |
| Shape/surface | Brand geometry, containment, state, interaction |
| Color | Existing NBTC palette — do NOT add new colors |
| Motion | Causality, feedback, spatial change ONLY |
| Responsive | Priority, order, density, input method |

---

## Do's and Don'ts

- **Do** use TH Sarabun New for ALL UI text — Thai and English
- **Do** use JetBrains Mono for coordinates, distances, dB values
- **Do** use Lucide React icons ONLY — no emoji anywhere
- **Do** maintain 8px grid alignment throughout
- **Do** use black borders (1px solid #000) for spectrum blocks
- **Do** follow Gridgeist state inventory (default/hover/focus/disabled/loading/empty/error)
- **Don't** use gradients, glows, or glassmorphism
- **Don't** use decorative elements — no corner ornaments, no abstract glyphs
- **Don't** use pure black (#000000) for text — use on-surface (#333333)
- **Don't** add dark mode — this is a government tool
- **Don't** use box-drawing characters in calculation logs
- **Don't** use ambient/decoration animations — motion = causality only
