export interface BlockResult {
  freq_low: number
  freq_high: number
  status: 'green' | 'gray' | 'red'
  max_eirp: number | null
  reason: string
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
    polarization: string
  }
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
  polarization: string
  status: string
}

export interface IMTBlock {
  freq_low: number
  freq_high: number
  status: string
}

export interface IMTAllocation {
  id: string
  name: string
  operator: string
  center_lat: number
  center_lon: number
  cell_radius: number
  antenna_height: number
  antenna_gain: number
  max_eirp: number
  status: string
  blocks: IMTBlock[]
  created_at: string
}

export interface IMTAllocationCreate {
  name: string
  operator: string
  center_lat: number
  center_lon: number
  cell_radius: number
  antenna_height: number
  antenna_gain: number
  max_eirp: number
}

// ─── Phase 0: Victim/Interferer Pairs ───────────────────────────────────────

export interface Pair {
  interferer_type: string
  interferer_name: string
  victim_type: string
  victim_name: string
  direction: string
  freq_overlap_low: number
  freq_overlap_high: number
  distance_m: number
  within_beam: boolean | null
  estimated_i_dbm: number
  preliminary_risk: 'HIGH' | 'MEDIUM' | 'LOW'
}

// ─── Phase 1: Detailed Pair Results ─────────────────────────────────────────

export interface PairResult {
  direction: string
  interferer: string
  victim: string
  i_dbm: number
  threshold_dbm: number
  margin_db: number
  path_loss_db: number
  effective_distance_m: number
  verdict: 'CONFLICT' | 'CLEAR' | 'GUARD_BAND'
  detail: string
}

// ─── Backend Verification ───────────────────────────────────────────────────

export interface BackendVerification {
  block_count: { pass: boolean; expected?: number; actual?: number; reason?: string }
  frequency_continuity: { pass: boolean; reason?: string }
  guard_adjacency: { pass: boolean; warnings?: number; reason?: string }
  total_mhz: { pass: boolean; expected?: number; actual?: number; reason?: string }
  guard_reasons: { pass: boolean; invalid_count?: number; reason?: string }
  all_pass: boolean
}

// ─── Coverage Engine (Phase 15) ─────────────────────────────────────────────

export interface CoverageInfo {
  auto_eirp: boolean
  used_eirp_dbm: number
  cell_edge_rss_dbm: number
  required_eirp_dbm: number
  coverage_classification: 'OUTDOOR_GOOD' | 'OUTDOOR_BASIC' | 'MARGINAL' | 'INADEQUATE'
  target_rss_dbm: number
  shadow_margin_db: number
  building_loss_db?: number
}

// ─── Full Analyze Response ──────────────────────────────────────────────────

export interface AnalyzeSummary {
  total_blocks: number
  green: number
  gray: number
  red: number
  pairs_identified?: number
  pairs_high_risk?: number
  pairs_conflict?: number
}

export interface AnalyzeResponse {
  blocks: BlockResult[]
  summary: AnalyzeSummary
  pairs?: Pair[]
  pair_results?: PairResult[]
  verification?: BackendVerification
  coverage?: CoverageInfo
  computation_time_ms?: number
}
