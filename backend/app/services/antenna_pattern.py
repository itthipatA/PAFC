"""
ITU-R F.699-9 reference radiation pattern generator for fixed wireless system (FWS) antennas.

Implements recommends 2 of Rec. ITU-R F.699-9 (02/2026):
  "Reference radiation patterns for fixed wireless system antennas for use in
   coordination studies and interference assessment in the frequency range
   from 100 MHz to 174.8 GHz"

Primary case for PAFC (parabolic dish, D/lambda <= 100, 1-70 GHz) = section 2.2.1.

Sections implemented:
  - 2.2.1  (D/lambda <= 100, 1-70 GHz)             — main
  - 2.1.1  (D/lambda > 100, 1-70 GHz)              — fallback (phi_r derived from continuity)
  - recommends 3 / 4 estimation helpers (gain-only / beamwidth-only inputs)

Reference formula (2.2.1), phi in degrees:
    G(phi) = Gmax - 2.5e-3 * (D/lambda * phi)^2       0 < phi < phi_m
    G(phi) = G1 = 2 + 15*log10(D/lambda)             phi_m <= phi < 100*lambda/D
    G(phi) = 52 - 10*log10(D/lambda) - 25*log10(phi)  100*lambda/D <= phi < 48
    G(phi) = 10 - 10*log10(D/lambda)                  48 <= phi <= 180
    phi_m  = (lambda/D) * 20 * sqrt(Gmax - G1)

NOTE: the F.699-9 main lobe is a conservative reference envelope — its -3 dB
beamwidth is wider than a real high-performance dish datasheet value.
"""
import math
import json

C = 299.792458  # Mm/s  →  lambda(m) = C / f(MHz)


def wavelength_m(freq_mhz: float) -> float:
    return C / freq_mhz


def f699_gain_db(off_axis_deg: float, gmax_dbi: float, D_m: float, freq_mhz: float) -> float:
    """Gain (dBi) at off-axis angle phi (deg) per ITU-R F.699-9."""
    lam = wavelength_m(freq_mhz)
    D_l = D_m / lam
    phi = abs(off_axis_deg)

    G1 = 2.0 + 15.0 * math.log10(D_l)
    phi_m = (lam / D_m) * 20.0 * math.sqrt(max(gmax_dbi - G1, 0.0))

    if D_l <= 100.0:
        # Section 2.2.1 (1-70 GHz)
        if phi < phi_m:
            return gmax_dbi - 2.5e-3 * (D_l * phi) ** 2
        if phi < 100.0 * lam / D_m:
            return G1
        if phi < 48.0:
            return 52.0 - 10.0 * math.log10(D_l) - 25.0 * math.log10(phi)
        return 10.0 - 10.0 * math.log10(D_l)
    else:
        # Section 2.1.1 (1-70 GHz) — phi_r where plateau meets 32-25log(phi)
        phi_r = 10.0 ** ((32.0 - G1) / 25.0)
        if phi < phi_m:
            return gmax_dbi - 2.5e-3 * (D_l * phi) ** 2
        if phi < phi_r:
            return G1
        if phi < 48.0:
            return 32.0 - 25.0 * math.log10(phi)
        return -10.0


def f699_pattern(
    gmax_dbi: float,
    D_m: float,
    freq_mhz: float,
    step_deg: float = 0.1,
) -> list:
    """Full 0-360 deg pattern as [[angle_deg, gain_dBi], ...] (F.699-9, section 2.2.1/2.1.1)."""
    lam = wavelength_m(freq_mhz)
    D_l = D_m / lam
    if not (1000.0 <= freq_mhz <= 70000.0):
        raise ValueError(
            f"freq {freq_mhz} MHz outside implemented 1-70 GHz range "
            "(F.699-9 sections 2.2.1/2.1.1)"
        )
    n = int(round(360.0 / step_deg)) + 1
    pattern = []
    for i in range(n):
        phi = round(i * step_deg, 6)
        pattern.append([phi, round(f699_gain_db(phi, gmax_dbi, D_m, freq_mhz), 2)])
    return pattern


def f699_beamwidth_deg(gmax_dbi: float, D_m: float, freq_mhz: float) -> float:
    """Full -3 dB beamwidth from the F.699-9 main-lobe parabola: 2*sqrt(3/2.5e-3)/(D/lambda)."""
    D_l = D_m / wavelength_m(freq_mhz)
    return 2.0 * (math.sqrt(3.0 / 2.5e-3) / D_l)


# ── Estimation helpers (Rec. F.699-9 recommends 3 & 4) ──────────────────────

def estimate_d_over_lambda_from_gain(gmax_dbi: float) -> float:
    """20*log10(D/lambda) ~= Gmax - 7.7"""
    return 10.0 ** ((gmax_dbi - 7.7) / 20.0)


def estimate_gain_from_beamwidth(bw_deg: float) -> float:
    """Gmax(dBi) ~= 44.5 - 20*log10(theta)"""
    return 44.5 - 20.0 * math.log10(bw_deg)


def estimate_d_over_lambda_from_beamwidth(bw_deg: float) -> float:
    """D/lambda ~= 70 / theta"""
    return 70.0 / bw_deg


def pattern_json(gmax_dbi: float, D_m: float, freq_mhz: float, step_deg: float = 0.1) -> str:
    """Self-describing JSON document for the fs_links.antenna_pattern column."""
    lam = wavelength_m(freq_mhz)
    D_l = D_m / lam
    section = "2.2.1" if D_l <= 100.0 else "2.1.1"
    return json.dumps({
        "standard": "ITU-R F.699-9",
        "section": section,
        "Gmax_dBi": gmax_dbi,
        "D_m": D_m,
        "freq_mhz": freq_mhz,
        "D_over_lambda": round(D_l, 3),
        "beamwidth_3dB_deg": round(f699_beamwidth_deg(gmax_dbi, D_m, freq_mhz), 2),
        "step_deg": step_deg,
        "pattern": f699_pattern(gmax_dbi, D_m, freq_mhz, step_deg),
    })


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Generate ITU-R F.699-9 antenna pattern")
    ap.add_argument("--freq", type=float, required=True, help="frequency (MHz)")
    ap.add_argument("--gain", type=float, required=True, help="max gain (dBi)")
    ap.add_argument("--diam", type=float, required=True, help="antenna diameter (m)")
    ap.add_argument("--step", type=float, default=0.1)
    args = ap.parse_args()

    doc = json.loads(pattern_json(args.gain, args.diam, args.freq, args.step))
    print(json.dumps({k: v for k, v in doc.items() if k != "pattern"}, indent=2))
    print(f"pattern points: {len(doc['pattern'])}")
    print(f"sample: {doc['pattern'][:5]} ... {doc['pattern'][-3:]}")
