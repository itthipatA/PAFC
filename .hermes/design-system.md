# PAFC Dashboard — Design System v2 (NBTC)

## Brand Colors

| Role | Hex | RGB | Usage |
|------|-----|-----|-------|
| **Primary** | `#C00000` | rgb(192,0,0) | Navbar, buttons, headers, active states |
| Primary Dark | `#8B0000` | rgb(139,0,0) | Hover, pressed states |
| Primary Light | `#FFE5E5` | rgb(255,229,229) | Light backgrounds, selected rows |
| **Secondary** | `#1A365D` | rgb(26,54,93) | Sidebar, secondary text, deep contrast |
| **Accent** | `#B8860B` | rgb(184,134,11) | Gold accent (Thai government) |
| Background | `#F8F9FA` | — | Page background |
| Surface | `#FFFFFF` | — | Cards, modals |
| Border | `#DEE2E6` | — | Dividers, table borders |
| Text Primary | `#212529` | — | Body text |
| Text Secondary | `#6C757D` | — | Helper text, labels |
| Muted | `#F1F3F5` | — | Disabled states |

## Spectrum Status Colors

| Status | Hex | Map Usage |
|--------|-----|-----------|
| 🟢 Green (Available) | `#16A34A` | Allocable block |
| ⚪ Gray (Guard Band) | `#9CA3AF` | Protection zone |
| 🔴 Red (Unavailable) | `#DC2626` | FS conflict / IMT collision |

## Typography
- **Headings:** Noto Sans Thai (clear Thai rendering)
- **Body:** Sarabun (official Thai government font)
- **Monospace:** Fira Code (frequency data)
- Google Fonts: `Noto+Sans+Thai:wght@400;500;600;700&family=Sarabun:wght@300;400;500;600;700&family=Fira+Code:wght@400;500;600&display=swap`

## Spacing
- Tailwind default (4px base)
- Card padding: 24px
- Map takes 100% viewport height minus header

## Components
- Header: Dark red (`#C00000`) background, white text
- Buttons: Primary filled red, secondary outlined
- Table: Striped rows, red header
- Map tooltip: White card with shadow
