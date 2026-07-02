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
