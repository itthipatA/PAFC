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
