import { useState } from 'react'
import {
  Octagon,
  Trash2,
  Undo2,
  X,
  MapPin,
  Play,
  Check,
} from 'lucide-react'

/* ══════════════════════════════════════════════════════════
   PolygonCreator — Gridgeist Redesign
   DESIGN.md tokens:
     primary:       #C00000   (NBTC red)
     surface:       #F5F5F0   (warm off-white)
     surface-ctn:   #FFFFFF   (cards)
     on-surface:    #333333   (text)
     on-surface-v:  #666666   (secondary text)
     success:       #2E7D32   (green)
     outline:       #E5E5E0   (card border)
     spectrum-orange: #E65100 (drawing active)
     error:         #BA1A1A
   Typography: TH Sarabun New (UI), JetBrains Mono (data)
   Motion: 150ms transitions only (causality)
   ══════════════════════════════════════════════════════════ */

/* ── Polygon Math Helpers ──────────────────────────────── */

function computePolygonArea(vertices: [number, number][]): number {
  if (vertices.length < 3) return 0
  let area = 0
  for (let i = 0; i < vertices.length; i++) {
    const [x1, y1] = vertices[i]
    const [x2, y2] = vertices[(i + 1) % vertices.length]
    area += x1 * y2 - x2 * y1
  }
  area = Math.abs(area) / 2
  // Approximate km²: 1 deg² ≈ (111.32 km)² adjusted for latitude
  const avgLat =
    vertices.reduce((sum, v) => sum + v[1], 0) / vertices.length
  const latRad = (avgLat * Math.PI) / 180
  const kmPerDegLat = 111.32
  const kmPerDegLon = 111.32 * Math.cos(latRad)
  return area * kmPerDegLat * kmPerDegLon
}

function computeCentroid(
  vertices: [number, number][],
): [number, number] {
  if (vertices.length === 0) return [0, 0]
  const sumLon = vertices.reduce((sum, v) => sum + v[0], 0)
  const sumLat = vertices.reduce((sum, v) => sum + v[1], 0)
  return [sumLon / vertices.length, sumLat / vertices.length]
}

/* ── Component ─────────────────────────────────────────── */

interface PolygonCreatorProps {
  onClose: () => void
  vertices: [number, number][]
  onVerticesChange: (vertices: [number, number][]) => void
  drawingMode: boolean
  onDrawingModeChange: (mode: boolean) => void
}

export default function PolygonCreator({
  onClose,
  vertices,
  onVerticesChange,
  drawingMode,
  onDrawingModeChange,
}: PolygonCreatorProps) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveFileName, setSaveFileName] = useState('')

  /* ── Derived State ─────────────────────────────────── */
  const isPolygonReady = vertices.length >= 3

  // "Finished" = polygon is closed (last vertex equals first)
  const isFinished =
    vertices.length >= 4 &&
    vertices[0][0] === vertices[vertices.length - 1][0] &&
    vertices[0][1] === vertices[vertices.length - 1][1]

  const polygonArea = isFinished
    ? computePolygonArea(vertices.slice(0, -1))
    : vertices.length >= 3
      ? computePolygonArea(vertices)
      : 0

  const centroid = computeCentroid(
    isFinished ? vertices.slice(0, -1) : vertices,
  )

  /* ── Handlers (preserved from original) ────────────── */

  const handleClosePolygon = () => {
    if (vertices.length < 3) return
    const closed = [...vertices, vertices[0]] as [number, number][]
    onVerticesChange(closed)
  }

  const handleClear = () => {
    onVerticesChange([])
  }

  const handleUndo = () => {
    onVerticesChange(vertices.slice(0, -1))
  }

  const handleOpenSaveDialog = () => {
    if (!isPolygonReady) return
    setSaveFileName('ที่ดิน')
    setSaveDialogOpen(true)
  }

  const handleConfirmSave = () => {
    const polygonCoords = [...vertices]
    if (
      polygonCoords[0][0] !==
        polygonCoords[polygonCoords.length - 1][0] ||
      polygonCoords[0][1] !==
        polygonCoords[polygonCoords.length - 1][1]
    ) {
      polygonCoords.push(polygonCoords[0])
    }
    const feature = {
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [polygonCoords],
      },
      properties: { name: saveFileName || 'ที่ดิน' },
    }
    const blob = new Blob([JSON.stringify(feature, null, 2)], {
      type: 'application/geo+json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${saveFileName || 'ที่ดิน'}.geojson`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setSaveDialogOpen(false)
  }

  /* ── Render ────────────────────────────────────────── */

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ fontFamily: 'TH Sarabun New, Sarabun, sans-serif' }}
    >
      {/* ═══════════════════════════════════════════════════════
          ZONE 1: HEADER — title + close X
          border-bottom 1px #E5E5E0
          ════════════════════════════════════════════════════ */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid #E5E5E0' }}
      >
        <h2
          className="text-xl font-bold"
          style={{ color: '#333333' }}
        >
          สร้างโพลีกอนที่ดิน
        </h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          style={{ transitionDuration: '150ms' }}
          title="ปิด"
          aria-label="ปิด"
        >
          <X className="w-5 h-5" style={{ color: '#666666' }} />
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════
          ZONE 2: INSTRUCTIONS — numbered steps
          Only visible when polygon not yet finished
          ════════════════════════════════════════════════════ */}
      {!isFinished && (
        <div className="px-4 pt-4 pb-2 shrink-0">
          <div
            className="space-y-1.5"
            style={{ color: '#666666', fontSize: '0.95rem', lineHeight: 1.6 }}
          >
            <div className="flex items-start gap-2">
              <span
                className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold mt-0.5"
                style={{
                  backgroundColor: '#C00000',
                  color: '#FFFFFF',
                  fontFamily: 'JetBrains Mono, Fira Code, monospace',
                }}
              >
                1
              </span>
              <span>กด &apos;เริ่มวาด&apos; เพื่อเข้าสู่โหมดวาด</span>
            </div>
            <div className="flex items-start gap-2">
              <span
                className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold mt-0.5"
                style={{
                  backgroundColor: '#C00000',
                  color: '#FFFFFF',
                  fontFamily: 'JetBrains Mono, Fira Code, monospace',
                }}
              >
                2
              </span>
              <span>คลิกบนแผนที่เพื่อวางจุดแต่ละมุม</span>
            </div>
            <div className="flex items-start gap-2">
              <span
                className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold mt-0.5"
                style={{
                  backgroundColor: '#C00000',
                  color: '#FFFFFF',
                  fontFamily: 'JetBrains Mono, Fira Code, monospace',
                }}
              >
                3
              </span>
              <span>กด &apos;เสร็จ&apos; เมื่อวางจุดครบ</span>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* ═══════════════════════════════════════════════════════
            ZONE 3: DRAWING CONTROLS — 3 equal-width buttons
            ════════════════════════════════════════════════════ */}

        {/* Drawing status indicator */}
        {drawingMode && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
            style={{
              backgroundColor: '#FFF3E0',
              color: '#E65100',
              borderLeft: '3px solid #E65100',
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: '#E65100',
                animation: 'pulseRing 2s cubic-bezier(0.4,0,0.2,1) infinite',
              }}
            />
            กำลังวาด — คลิกบนแผนที่เพื่อวางจุด
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {/* ── เริ่มวาด ────────────────────────────────── */}
          {!drawingMode ? (
            <button
              onClick={() => onDrawingModeChange(true)}
              className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-sm font-semibold transition-colors"
              style={{
                backgroundColor: '#C00000',
                color: '#FFFFFF',
                transitionDuration: '150ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#A00000'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#C00000'
              }}
            >
              <Play className="w-4 h-4" />
              เริ่มวาด
            </button>
          ) : (
            <button
              onClick={() => onDrawingModeChange(false)}
              className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-sm font-semibold transition-colors animate-pulse"
              style={{
                backgroundColor: '#E65100',
                color: '#FFFFFF',
                transitionDuration: '150ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#BF4400'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#E65100'
              }}
            >
              <Play className="w-4 h-4" />
              กำลังวาด
            </button>
          )}

          {/* ── เสร็จ ───────────────────────────────────── */}
          <button
            disabled={vertices.length < 3}
            onClick={handleClosePolygon}
            className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: '#2E7D32',
              color: '#FFFFFF',
              transitionDuration: '150ms',
            }}
            onMouseEnter={(e) => {
              if (vertices.length >= 3)
                e.currentTarget.style.backgroundColor = '#1B5E20'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#2E7D32'
            }}
          >
            <Check className="w-4 h-4" />
            เสร็จ
          </button>

          {/* ── ล้างทั้งหมด ────────────────────────────── */}
          <button
            disabled={vertices.length === 0}
            onClick={handleClear}
            className="flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'transparent',
              color: '#666666',
              border: '1px solid #CCCCCC',
              transitionDuration: '150ms',
            }}
            onMouseEnter={(e) => {
              if (vertices.length > 0) {
                e.currentTarget.style.backgroundColor = '#F5F5F5'
                e.currentTarget.style.borderColor = '#999999'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.borderColor = '#CCCCCC'
            }}
          >
            <Trash2 className="w-4 h-4" />
            ล้างทั้งหมด
          </button>
        </div>

        {/* ═══════════════════════════════════════════════════════
            ZONE 4: VERTEX LIST — จุดยอด ({count}) + numbered rows
            ════════════════════════════════════════════════════ */}
        {vertices.length > 0 && (
          <div
            className="rounded-lg p-4 space-y-3"
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #E5E5E0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div
                className="flex items-center gap-2 font-semibold"
                style={{ color: '#333333', fontSize: '0.95rem' }}
              >
                <MapPin className="w-4 h-4" style={{ color: '#C00000' }} />
                จุดยอด ({vertices.length})
              </div>
              {vertices.length > 0 && (
                <button
                  onClick={handleUndo}
                  className="flex items-center gap-1 text-xs rounded-md px-2 py-1 transition-colors"
                  style={{
                    color: '#666666',
                    transitionDuration: '150ms',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#F5F5F0'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  <Undo2 className="w-3 h-3" />
                  ย้อนกลับ
                </button>
              )}
            </div>

            {/* Vertex rows */}
            <div className="space-y-0">
              {vertices.map((v, i) => {
                const isClosingDuplicate =
                  isFinished && i === vertices.length - 1
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-2 transition-colors"
                    style={{
                      borderBottom:
                        i < vertices.length - 1
                          ? '1px solid #F0F0EB'
                          : 'none',
                      opacity: isClosingDuplicate ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#FAFAF5'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    {/* Red circle with index */}
                    <span
                      className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold"
                      style={{
                        backgroundColor: isClosingDuplicate
                          ? '#999999'
                          : '#C00000',
                        color: '#FFFFFF',
                        fontFamily:
                          'JetBrains Mono, Fira Code, monospace',
                      }}
                    >
                      {i + 1}
                    </span>
                    {/* Coordinates in mono */}
                    <span
                      className="text-sm"
                      style={{
                        fontFamily:
                          'JetBrains Mono, Fira Code, monospace',
                        color: '#333333',
                        fontSize: '0.8125rem',
                      }}
                    >
                      {v[1].toFixed(7)},{' '}
                      <span style={{ color: '#666666' }}>
                        {v[0].toFixed(7)}
                      </span>
                    </span>
                    {isClosingDuplicate && (
                      <span
                        className="text-xs ml-auto"
                        style={{ color: '#999999' }}
                      >
                        (ปิดรูป)
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            ZONE 5: POLYGON INFO — area, points, centroid
            Only shown after polygon is finished (closed)
            ════════════════════════════════════════════════════ */}
        {isFinished && (
          <div
            className="rounded-lg p-4 space-y-4"
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #E5E5E0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            <h3
              className="font-bold"
              style={{ color: '#333333', fontSize: '1rem' }}
            >
              ข้อมูลโพลีกอน
            </h3>

            {/* Area — large mono */}
            <div>
              <span
                className="text-xs font-semibold block mb-0.5"
                style={{ color: '#666666' }}
              >
                พื้นที่
              </span>
              <span
                className="text-2xl font-bold"
                style={{
                  fontFamily: 'JetBrains Mono, Fira Code, monospace',
                  color: '#C00000',
                }}
              >
                {polygonArea.toFixed(4)}
              </span>
              <span
                className="text-sm ml-1"
                style={{ color: '#666666' }}
              >
                km²
              </span>
            </div>

            {/* Points + Centroid in 2-col grid */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span
                  className="text-xs font-semibold block mb-0.5"
                  style={{ color: '#666666' }}
                >
                  จำนวนจุด
                </span>
                <span
                  className="font-bold"
                  style={{
                    fontFamily: 'JetBrains Mono, Fira Code, monospace',
                    color: '#333333',
                  }}
                >
                  {vertices.length - 1}
                </span>
              </div>
              <div>
                <span
                  className="text-xs font-semibold block mb-0.5"
                  style={{ color: '#666666' }}
                >
                  จุดศูนย์กลาง
                </span>
                <span
                  className="text-sm font-bold block"
                  style={{
                    fontFamily: 'JetBrains Mono, Fira Code, monospace',
                    color: '#333333',
                  }}
                >
                  {centroid[1].toFixed(7)}
                </span>
                <span
                  className="text-sm"
                  style={{
                    fontFamily: 'JetBrains Mono, Fira Code, monospace',
                    color: '#666666',
                  }}
                >
                  {centroid[0].toFixed(7)}
                </span>
              </div>
            </div>

            {/* วิเคราะห์ที่ดิน button */}
            <button
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-colors"
              style={{
                backgroundColor: '#C00000',
                color: '#FFFFFF',
                transitionDuration: '150ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#A00000'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#C00000'
              }}
            >
              <Octagon className="w-4 h-4" />
              วิเคราะห์ที่ดิน
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            ZONE 6: ERROR — inline alert (contingency)
            ════════════════════════════════════════════════════ */}
        {vertices.length > 0 && vertices.length < 3 && isFinished === false && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
            style={{
              backgroundColor: '#FFEBEE',
              color: '#BA1A1A',
              border: '1px solid #FFCDD2',
            }}
          >
            <X className="w-4 h-4 shrink-0" />
            ต้องมีอย่างน้อย 3 จุดเพื่อสร้างโพลีกอน
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════
          ZONE 7: BOTTOM ACTIONS — บันทึก + ยกเลิก
          ════════════════════════════════════════════════════ */}
      {isFinished && (
        <div
          className="flex gap-3 px-4 py-3 shrink-0"
          style={{ borderTop: '1px solid #E5E5E0' }}
        >
          <button
            onClick={handleOpenSaveDialog}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-colors"
            style={{
              backgroundColor: '#2E7D32',
              color: '#FFFFFF',
              transitionDuration: '150ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#1B5E20'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#2E7D32'
            }}
          >
            <Check className="w-4 h-4" />
            บันทึก
          </button>
          <button
            onClick={onClose}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-colors"
            style={{
              backgroundColor: 'transparent',
              color: '#666666',
              border: '1px solid #CCCCCC',
              transitionDuration: '150ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#F5F5F5'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            ยกเลิก
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          SAVE DIALOG MODAL
          ════════════════════════════════════════════════════ */}
      {saveDialogOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className="rounded-xl p-6 w-[320px]"
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #E5E5E0',
              boxShadow:
                '0 4px 24px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)',
            }}
          >
            <h3
              className="font-bold mb-4"
              style={{ color: '#333333', fontSize: '1rem' }}
            >
              บันทึกไฟล์ที่ดิน
            </h3>
            <label
              className="text-sm font-semibold mb-1 block"
              style={{ color: '#666666' }}
            >
              ชื่อไฟล์
            </label>
            <input
              type="text"
              value={saveFileName}
              onChange={(e) => setSaveFileName(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' && handleConfirmSave()
              }
              className="w-full px-3 py-2 rounded-md text-sm outline-none transition-colors"
              style={{
                border: '1px solid #CCCCCC',
                color: '#333333',
                fontFamily: 'TH Sarabun New, Sarabun, sans-serif',
                transitionDuration: '150ms',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#C00000'
                e.currentTarget.style.boxShadow =
                  '0 0 0 3px rgba(192,0,0,0.15)'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#CCCCCC'
                e.currentTarget.style.boxShadow = 'none'
              }}
              placeholder="ระบุชื่อไฟล์..."
              autoFocus
            />
            <p
              className="mt-1"
              style={{
                color: '#999999',
                fontSize: '0.75rem',
              }}
            >
              .geojson
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setSaveDialogOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                style={{
                  color: '#666666',
                  transitionDuration: '150ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#F5F5F0'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                }}
              >
                ยกเลิก
              </button>
              <button
                onClick={handleConfirmSave}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                style={{
                  backgroundColor: '#C00000',
                  color: '#FFFFFF',
                  transitionDuration: '150ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#A00000'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#C00000'
                }}
              >
                ดาวน์โหลด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
