// Phase 37 Types

export interface AllocationBlock {
  freq_low: number
  freq_high: number
  index: number
  status: 'available' | 'blocked_by_fs' | 'blocked_by_imt'
  blocked_by: string[]
  reason_th: string
  can_be_guard: boolean
  guard_reason_th: string
}

export interface AllocationAnalyzeResponse {
  blocks: AllocationBlock[]
  narrative_log: string[]
  summary: string
  existing_imt_count: number
  existing_fs_count: number
  selected_frame_structure: string
}

export interface FrameStructureOption {
  value: string
  label: string
  description: string
  dl_ratio: number
  period_ms: number
}

export interface SaveBlock {
  freq_low: number
  freq_high: number
  status: 'allocated' | 'guard'
}

export interface AllocationSaveRequest {
  name: string
  operator: string
  polygon_geojson: object
  frame_structure: string
  selected_blocks: SaveBlock[]
}

export interface FSLink {
  id: string
  name: string
  operator: string
  tx: { lat: number; lon: number; altitude: number }
  rx: { lat: number; lon: number; altitude: number }
  frequency: { low: number; high: number; bandwidth: number }
  rf: {
    tx_power: number
    tx_antenna_gain: number
    rx_antenna_gain: number
    azimuth: number
    beamwidth_deg: number
    polarization: string
  }
  antenna_pattern: string | null
  link_polygon: object | null
  status: string
}

export interface IMTAllocation {
  id: string
  name: string
  operator: string
  polygon_geojson: object | null
  frame_structure: string | null
  status: string
  blocks: IMTBlock[]
  created_at: string
}

export interface IMTBlock {
  freq_low: number
  freq_high: number
  status: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  username: string
  role: string
}

export interface User {
  username: string
  role: string
}

export interface FSLinkCreate {
  name: string
  operator: string
  tx_lat: number
  tx_lon: number
  tx_altitude: number
  rx_lat: number
  rx_lon: number
  rx_altitude: number
  freq_low: number
  freq_high: number
  bandwidth: number
  tx_power: number
  tx_antenna_gain: number
  rx_antenna_gain: number
  azimuth: number
  beamwidth_deg: number
  polarization: string
  status: string
}
