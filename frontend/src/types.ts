export interface BlockResult {
  freq_low: number
  freq_high: number
  status: 'green' | 'gray' | 'red'
  max_eirp: number | null
  reason: string
  i_total_dbm?: number | null  // Aggregate interference — combined
  i_total_to_new_imt_dbm?: number | null  // Aggregate → new IMT (FS + existing IMT interferers)
  i_total_to_fs_dbm?: number | null       // Aggregate → FS receivers
  i_total_to_existing_imt_dbm?: number | null  // Aggregate → existing IMT
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
  antenna_type: string
  sector_beamwidth_deg: number
  sector_azimuth_deg: number
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
  antenna_type: string
  sector_beamwidth_deg: number
  sector_azimuth_deg: number
  // Coverage params (Phase 15)
  target_rss?: number
  shadow_margin?: number
  building_loss?: number
  propagation_model?: string
  coverage_classification?: string
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
  propagation_model?: string
  used_eirp_dbm: number
  cell_edge_rss_dbm: number
  required_eirp_dbm: number
  actual_path_loss_db?: number
  coverage_classification: 'OUTDOOR_GOOD' | 'OUTDOOR_BASIC' | 'MARGINAL' | 'INADEQUATE'
  target_rss_dbm: number
  shadow_margin_db: number
  building_loss_db?: number
}

// ─── Trade-off (Phase 15) ──────────────────────────────────────────────────

export interface TradeOff {
  resolution_type: 'eirp_reduction' | 'partial' | 'relocation_required'
  original_radius_m: number
  original_eirp_dbm: number
  suggested_radius_m: number
  suggested_eirp_dbm: number
  radius_reduction_pct: number
  conflicting_systems: string[]
  message: string
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
  assumptions?: Record<string, AssumptionItem>  // สมมุติฐานทางวิศวกรรม
  pairs?: Pair[]
  pair_results?: PairResult[]
  verification?: BackendVerification
  coverage?: CoverageInfo
  tradeoff?: TradeOff
  computation_time_ms?: number
  model_used?: string
}

// ─── Engineering Assumptions ──────────────────────────────────────────────────

export interface AssumptionItem {
  label: string
  value: string
  description: string
  reference: string
  impact: string
  impact_en?: string
  limitations?: string[]
  reality_check?: string
}
