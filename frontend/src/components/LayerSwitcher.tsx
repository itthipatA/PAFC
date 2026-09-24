// Google-Maps-desktop-style layer switcher.
// Floating Layers button (bottom-left) expanding to Map/Satellite
// thumbnail cards. Thumbnails reuse real Google tile sessions.
import { useEffect, useRef, useState } from 'react'
import { Layers } from 'lucide-react'
import { createTileSession, getGoogleTileUrl } from '../lib/googleTiles'

interface LayerSwitcherProps {
  current: string
  onChange: (style: string) => void
}

// Bangkok overview tile for thumbnails
const THUMB_Z = 10
const THUMB_X = 797
const THUMB_Y = 472

const FALLBACK_ROADMAP = '#E8EAE6'
const FALLBACK_SATELLITE = '#1A2E1A'

export default function LayerSwitcher({ current, onChange }: LayerSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [thumbs, setThumbs] = useState<{ roadmap: string | null; satellite: string | null }>({
    roadmap: null,
    satellite: null,
  })
  const loadedRef = useRef(false)

  // Fetch one session per type on first expand — cached for the session
  useEffect(() => {
    if (!open || loadedRef.current) return
    loadedRef.current = true
    void (async () => {
      const next: { roadmap: string | null; satellite: string | null } = {
        roadmap: null,
        satellite: null,
      }
      try {
        const s = await createTileSession('roadmap')
        next.roadmap = getGoogleTileUrl(s).replace('{z}/{x}/{y}', `${THUMB_Z}/${THUMB_X}/${THUMB_Y}`)
      } catch (_e) { /* thumbnail fallback color */ }
      try {
        const s = await createTileSession('satellite')
        next.satellite = getGoogleTileUrl(s).replace('{z}/{x}/{y}', `${THUMB_Z}/${THUMB_X}/${THUMB_Y}`)
      } catch (_e) { /* thumbnail fallback color */ }
      setThumbs(next)
    })()
  }, [open ])

  const cards = [
    { key: 'google', label: 'แผนที่', thumb: thumbs.roadmap, fallback: FALLBACK_ROADMAP },
    { key: 'google_satellite', label: 'ดาวเทียม', thumb: thumbs.satellite, fallback: FALLBACK_SATELLITE },
  ]

  return (
    <div className="absolute left-3 bottom-8 z-10 flex flex-col items-start gap-2">
      {open && (
        <div className="flex gap-2 rounded-lg bg-white p-2 shadow-lg">
          {cards.map((c) => (
            <button
              key={c.key}
              onClick={() => {
                onChange(c.key)
                setOpen(false)
              }}
              className="flex w-20 flex-col items-center gap-1"
            >
              {c.thumb ? (
                <img
                  src={c.thumb}
                  alt={c.label}
                  className={`h-14 w-20 rounded-md border-2 object-cover ${
                    current === c.key ? 'border-[#C00000]' : 'border-gray-200'
                  }`}
                />
              ) : (
                <div
                  className={`h-14 w-20 rounded-md border-2 ${
                    current === c.key ? 'border-[#C00000]' : 'border-gray-200'
                  }`}
                  style={{ backgroundColor: c.fallback }}
                />
              )}
              <span
                className={`text-xs ${current === c.key ? 'font-semibold text-[#C00000]' : 'text-gray-700'}`}
              >
                {c.label}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        title="เลเยอร์"
        className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-gray-700 shadow-lg hover:bg-gray-50"
      >
        <Layers size={20} />
      </button>
    </div>
  )
}
