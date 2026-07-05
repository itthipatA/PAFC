import { useState } from 'react'
import {
  Octagon,
  Trash2,
  Undo2,
  Download,
  X,
  MapPin,
  Save,
} from 'lucide-react'
import { Button } from './Button'

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

  const isPolygonReady = vertices.length >= 3

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
      polygonCoords[0][0] !== polygonCoords[polygonCoords.length - 1][0] ||
      polygonCoords[0][1] !== polygonCoords[polygonCoords.length - 1][1]
    ) {
      polygonCoords.push(polygonCoords[0])
    }
    const feature = {
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [polygonCoords] },
      properties: { name: saveFileName || 'ที่ดิน' },
    }
    const blob = new Blob([JSON.stringify(feature, null, 2)], { type: 'application/geo+json' })
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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <h2 className="text-base font-bold text-[#1A1A2E]">สร้างโพลีกอนที่ดิน</h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          title="ปิด"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Section 1: Polygon Drawing */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[#1A1A2E]">วาดโพลีกอน</h3>
          <p className="text-xs text-gray-500">
            คลิกบนแผนที่เพื่อเพิ่มจุดมุมของที่ดิน กดปุ่ม ปิดรูป เมื่อครบทุกมุม
          </p>

          <div className="flex flex-wrap gap-2">
            {!drawingMode ? (
              <Button
                variant="primary"
                onClick={() => onDrawingModeChange(true)}
              >
                <MapPin className="w-4 h-4" />
                เริ่มวาด
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => onDrawingModeChange(false)}
              >
                <X className="w-4 h-4" />
                หยุดวาด
              </Button>
            )}

            <Button
              variant="secondary"
              disabled={vertices.length < 3}
              onClick={handleClosePolygon}
            >
              <Octagon className="w-4 h-4" />
              ปิดรูปหลายเหลี่ยม
            </Button>

            <Button
              variant="ghost"
              disabled={vertices.length === 0}
              onClick={handleUndo}
            >
              <Undo2 className="w-4 h-4" />
              ย้อนกลับ
            </Button>

            <Button
              variant="danger"
              disabled={vertices.length === 0}
              onClick={handleClear}
            >
              <Trash2 className="w-4 h-4" />
              ล้างทั้งหมด
            </Button>
          </div>

          <div className="text-sm text-gray-600">
            จำนวนจุด: <span className="font-bold text-[#C00000]">{vertices.length}</span>
          </div>

          {/* Vertex coordinates */}
          {vertices.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-gray-500 mb-2">พิกัดจุดมุม</h4>
              <div className="max-h-[250px] overflow-y-auto border border-gray-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-gray-500 font-medium">มุม</th>
                      <th className="px-2 py-1.5 text-left text-gray-500 font-medium">ละติจูด</th>
                      <th className="px-2 py-1.5 text-left text-gray-500 font-medium">ลองจิจูด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {vertices.map((v, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-2 py-1 font-mono text-gray-400">{i + 1}</td>
                        <td className="px-2 py-1 font-mono text-gray-700">{v[1].toFixed(7)}</td>
                        <td className="px-2 py-1 font-mono text-gray-700">{v[0].toFixed(7)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Section 2: Download */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-semibold text-[#1A1A2E]">บันทึกไฟล์</h3>

          <Button
            variant="secondary"
            disabled={!isPolygonReady}
            onClick={handleOpenSaveDialog}
          >
            <Save className="w-4 h-4" />
            บันทึกไฟล์ที่ดิน (GeoJSON)
          </Button>
        </div>
      </div>

      {/* Save Dialog Modal */}
      {saveDialogOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 p-6 w-[320px] animate-scale-in">
            <h3 className="text-sm font-semibold text-[#1A1A2E] mb-4">
              บันทึกไฟล์ที่ดิน
            </h3>
            <label className="text-xs text-gray-500 mb-1 block">ชื่อไฟล์</label>
            <input
              type="text"
              value={saveFileName}
              onChange={(e) => setSaveFileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirmSave()}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C00000]/30 focus:border-[#C00000]"
              placeholder="ระบุชื่อไฟล์..."
              autoFocus
            />
            <p className="text-[10px] text-gray-400 mt-1">.geojson</p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setSaveDialogOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleConfirmSave}
                className="px-4 py-2 text-sm bg-[#C00000] text-white rounded-lg hover:bg-[#8B0000] transition-colors"
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
