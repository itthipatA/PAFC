"""
Narrative Log Generator — produces human-readable explanation of engine calculations.

Moved from frontend (TypeScript) to backend (Python) so that:
- Engine owns the calculation AND the explanation
- When engine changes, log changes automatically
- Single source of truth — no frontend/backend sync needed

Frontend just renders: setLogLines(data.narrative_log)
"""

import math
from typing import Optional


def generate_narrative_log(
    # Input parameters
    center_lat: float,
    center_lon: float,
    cell_radius: float,
    antenna_height: float,
    antenna_gain: float,
    max_eirp: float,
    model_name: str,
    indoor_pct: float,
    # Engine outputs
    pairs: list,
    pair_results: list,
    blocks: list,
    block_limits: list,
    # Metadata
    fs_links_checked: int,
    neighbor_imts_checked: int,
    spatial_filter_km: float,
    elapsed_ms: float,
    computation_time_ms: float,
    # Optional
    coverage: Optional[dict] = None,
    assumptions: Optional[dict] = None,
    tradeoff: Optional[dict] = None,
    verification: Optional[dict] = None,
) -> list[str]:
    """Generate a complete narrative log of the interference analysis."""
    lines: list[str] = []

    model_label = model_name.upper() if model_name == "free_space" else model_name

    green = [b for b in blocks if getattr(b, 'status', '') == 'green']
    red = [b for b in blocks if getattr(b, 'status', '') == 'red']
    gray = [b for b in blocks if getattr(b, 'status', '') == 'gray']

    def _freq(b) -> float:
        return getattr(b, 'freq_low', 0)
    def _status(b) -> str:
        return getattr(b, 'status', '')
    def _reason(b) -> str:
        return getattr(b, 'reason', '')
    def _i_dbm(b) -> float:
        return getattr(b, 'i_total_dbm', None) or -200
    def _i_new(b) -> float:
        return getattr(b, 'i_total_to_new_imt_dbm', None) or -200
    def _i_fs(b) -> float:
        return getattr(b, 'i_total_to_fs_dbm', None) or -200
    def _i_ex(b) -> float:
        return getattr(b, 'i_total_to_existing_imt_dbm', None) or -200

    def _pr_dir(pr) -> str:
        if hasattr(pr, 'pair') and hasattr(pr.pair, 'direction'):
            return pr.pair.direction
        return getattr(pr, 'direction', '')
    def _pr_verdict(pr) -> str:
        return getattr(pr, 'verdict', '')
    def _pr_i(pr) -> float:
        return getattr(pr, 'i_dbm', -200)
    def _pr_pl(pr) -> float:
        return getattr(pr, 'path_loss_db', 0)
    def _pr_margin(pr) -> float:
        return getattr(pr, 'margin_db', 0)
    def _pr_threshold(pr) -> float:
        return getattr(pr, 'threshold_dbm', -114)
    def _pr_dist(pr) -> float:
        return getattr(pr, 'effective_distance_m', 0)
    def _pr_detail(pr) -> str:
        return getattr(pr, 'detail', '')
    def _pr_interferer(pr) -> str:
        return getattr(pr, 'interferer', '')
    def _pr_victim(pr) -> str:
        return getattr(pr, 'victim', '')
    def _pr_victim_type(pr) -> str:
        if hasattr(pr, 'pair') and hasattr(pr.pair, 'victim_type'):
            return pr.pair.victim_type
        return pr.get('pair', {}).get('victim_type', '') if isinstance(pr, dict) else ''

    # ═══════════════════════════════════════════
    # HEADER
    # ═══════════════════════════════════════════
    lines.append('═══════════════════════════════════════════════')
    lines.append('  PAFC INTERFERENCE ANALYSIS — DETAILED REPORT')
    lines.append('═══════════════════════════════════════════════')
    lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 1: INPUT PARAMETERS
    # ═══════════════════════════════════════════
    lines.append('─── 1. INPUT PARAMETERS ────────────────────────────────────────')
    lines.append(f'   Location        : ({center_lat:.4f}, {center_lon:.4f})')
    lines.append(f'   Cell Radius     : {cell_radius:.0f} m')
    lines.append(f'   Antenna Height  : {antenna_height:.0f} m AGL')
    lines.append(f'   Antenna Gain    : {antenna_gain:.0f} dBi')
    if coverage and coverage.get('auto_eirp'):
        lines.append(f'   Max EIRP        : {coverage["used_eirp_dbm"]:.1f} dBm (auto-calculated)')
    else:
        lines.append(f'   Max EIRP        : {max_eirp:.1f} dBm')
    lines.append(f'   Propagation     : {model_label}')
    lines.append('   Frequency Band  : 4800 – 4990 MHz (190 MHz, 19 blocks x 10 MHz)')
    lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 1.2: LINK BUDGET (Coverage Engine)
    # ═══════════════════════════════════════════
    if coverage and coverage.get('auto_eirp'):
        cov_model = coverage.get('propagation_model', 'free_space')
        classification = coverage.get('coverage_classification', 'N/A')
        pl = coverage.get('actual_path_loss_db')
        lines.append('─── 1.2 LINK BUDGET CALCULATION (Coverage Engine) ──────────────')
        lines.append(f'   Model           : {cov_model}')
        lines.append('')
        lines.append('   Input Parameters:')
        lines.append(f'     Cell Radius        : {cell_radius:.0f} m')
        lines.append(f'     Target RSS         : {coverage.get("target_rss_dbm", "?")} dBm')
        lines.append(f'     Shadow Margin      : {coverage.get("shadow_margin_db", "?")} dB')
        lines.append('')
        lines.append('   Formula:')
        lines.append('     EIRP_req = RSS_target + PathLoss(model, d, f) + Margin')
        lines.append('')
        lines.append('   Calculation:')
        pl_str = f'{pl:.1f}' if pl is not None else 'N/A'
        lines.append(f'     Path Loss ({cov_model})  : {pl_str} dB at cell edge')
        rss = coverage.get('target_rss_dbm', '?')
        sm = coverage.get('shadow_margin_db', '?')
        req = coverage.get('required_eirp_dbm', 0)
        lines.append(f'     Required EIRP      = {rss} + {pl_str} + {sm}')
        lines.append(f'                        = {req:.1f} dBm')
        lines.append(f'     Used EIRP          = {coverage.get("used_eirp_dbm", 0):.1f} dBm')
        lines.append(f'     Cell Edge RSS      = {coverage.get("cell_edge_rss_dbm", 0):.1f} dBm')
        lines.append('')
        lines.append(f'   Coverage Classification: {classification}')
        lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 1.3: BUILDING LOSS (Phase 29)
    # ═══════════════════════════════════════════
    if indoor_pct > 0:
        bl = indoor_pct / 100 * 20
        lines.append('─── 1.3 BUILDING LOSS TRACE (Phase 29) ──────────────────────────')
        lines.append('   Formula: building_loss = (indoor_pct/100) x 20 dB')
        lines.append(f'   building_loss = {indoor_pct:.0f}/100 x 20 = {bl:.1f} dB')
        eff_eirp = max(max_eirp - bl, 0)
        lines.append(f'   effective_eirp = EIRP - building_loss = {max_eirp:.1f} - {bl:.1f} = {eff_eirp:.1f} dBm')
        lines.append('')
        lines.append('   Impact on interference calculations:')
        lines.append(f'   > IMT as INTERFERER: EIRP reduced {bl:.1f} dB -> I reduced {bl:.1f} dB (directions 1/1b/3)')
        lines.append(f'   > IMT as VICTIM:     attenuation {bl:.1f} dB -> I reduced {bl:.1f} dB (directions 2/2b/4)')
        lines.append('   > Net: bidirectional protection')
        lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 1.4: ENGINEERING ASSUMPTIONS
    # ═══════════════════════════════════════════
    if assumptions and len(assumptions) > 0:
        lines.append('─── 1.4 KEY ENGINEERING ASSUMPTIONS ─────────────────────────────')
        lines.append('   These assumptions govern every calculation result.')
        lines.append('')
        order = ['interference_threshold', 'cochannel_protection', 'adjacent_protection',
                 'fs_beamwidth', 'fs_sidelobe', 'spatial_filter',
                 'propagation', 'imt_antenna', 'risk_classification']
        for key in order:
            a = assumptions.get(key)
            if not a:
                continue
            lines.append(f'   {a.get("label", key)}:')
            lines.append(f'     Value      : {a.get("value", "")}')
            lines.append(f'     Reference  : {a.get("reference", "")}')
            lines.append(f'     Impact     : {a.get("impact", "")}')
            limitations = a.get('limitations', [])
            if limitations:
                for lim in limitations:
                    lines.append(f'       - {lim}')
            lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 2: PHASE 0 — PRE-SCREEN
    # ═══════════════════════════════════════════
    if len(pairs) > 0:
        lines.append('─── 2. PHASE 0: VICTIM/INTERFERER IDENTIFICATION ───────────────')
        lines.append(f'   Search radius   : {spatial_filter_km:.1f} km (max IMT radius + max FS coord + 1 km margin)')
        lines.append('   Criterion: FSPL-derived — adapts to max FS EIRP in system')
        lines.append(f'   Systems checked : {fs_links_checked} FS links + {neighbor_imts_checked} IMT blocks')
        lines.append(f'   Pairs identified : {len(pairs)} total')

        high_risk = [p for p in pairs if (
            getattr(p, 'preliminary_risk', '') == 'HIGH')]
        med_risk = [p for p in pairs if (
            getattr(p, 'preliminary_risk', '') == 'MEDIUM')]
        low_risk = [p for p in pairs if (
            getattr(p, 'preliminary_risk', '') == 'LOW')]
        lines.append(f'   Risk distribution: {len(high_risk)} HIGH, {len(med_risk)} MEDIUM, {len(low_risk)} LOW')
        lines.append('')

        # Risk criteria
        lines.append('   --- Risk Classification Criteria ---')
        lines.append('   HIGH   : margin > +20 dB (far above threshold)')
        lines.append('   MEDIUM : margin > -10 dB OR distance < 1 km')
        lines.append('   LOW    : otherwise')
        lines.append('')

        # Direction breakdown
        all_dirs = ['IMT→FS', 'IMT→FS_ADJACENT', 'FS→IMT', 'FS→IMT_ADJACENT',
                     'IMT↔IMT_COCHANNEL', 'IMT↔IMT_ADJACENT']
        dir_labels = ['➀ IMT→FS (co)', '➀b IMT→FS (adj)', '➁ FS→IMT (co)',
                       '➁b FS→IMT (adj)', '➂/➃ IMT↔IMT (co)', 'IMT↔IMT (adj)']
        lines.append('   --- Direction Breakdown ---')
        for d, label in zip(all_dirs, dir_labels):
            count = sum(1 for p in pairs if (
                getattr(p, 'direction', '') == d))
            if count > 0:
                lines.append(f'   {label}: {count} pairs')
        lines.append('')

        # HIGH RISK pairs
        if high_risk:
            lines.append('   === HIGH RISK PAIRS ===')
            for i, p in enumerate(high_risk):
                direction = getattr(p, 'direction', '')
                iname = getattr(p, 'interferer_name', '')
                vname = getattr(p, 'victim_name', '')
                f_low = getattr(p, 'freq_overlap_low', None)
                f_high = getattr(p, 'freq_overlap_high', None)
                dist = getattr(p, 'distance_m', 0)
                est_i = getattr(p, 'estimated_i_dbm', -200)
                within_beam = getattr(p, 'within_beam', None)

                freq_str = f'{f_low:.0f}-{f_high:.0f} MHz' if f_low and f_high else 'N/A'
                lines.append(f'   {i+1}. {direction}: {iname} → {vname}')
                lines.append(f'      Freq: {freq_str} | Dist: {dist/1000:.1f} km')
                lines.append(f'      Phase 0 est: I = EIRP − PL(d,f) + G − disc ≈ {est_i:.1f} dBm')
                if direction == 'FS→IMT' and within_beam is not None:
                    beam = 'IMT IN main beam' if within_beam else 'IMT outside beam (-25 dB)'
                    lines.append(f'      FS beam: {beam}')
        if med_risk:
            lines.append('')
            lines.append('   === MEDIUM RISK PAIRS ===')
            for i, p in enumerate(med_risk):
                direction = getattr(p, 'direction', '')
                iname = getattr(p, 'interferer_name', '')
                vname = getattr(p, 'victim_name', '')
                lines.append(f'   {i+1}. {direction}: {iname} → {vname}')
        lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 3: PROPAGATION MODEL
    # ═══════════════════════════════════════════
    lines.append('─── 3. PROPAGATION MODEL ───────────────────────────────────────')
    if model_name == 'free_space':
        fspl1km = 32.4 + 20 * math.log10(1) + 20 * math.log10(4900)
        lines.append('   Model           : Free Space Path Loss (FSPL)')
        lines.append('   Formula         : FSPL(dB) = 32.4 + 20·log10(d_km) + 20·log10(f_MHz)')
        lines.append('   Description     : Free-space propagation, no obstacles')
        lines.append('')
        lines.append('   Example: at 1 km, 4900 MHz:')
        lines.append('     FSPL = 32.4 + 20·log10(1) + 20·log10(4900)')
        lines.append('          = 32.4 + 0 + 73.8')
        lines.append(f'          = {fspl1km:.1f} dB')
    elif model_name == 'p452':
        lines.append('   Model           : ITU-R P.452')
        lines.append('   Description     : Accounts for weather, terrain, and scattering')
    else:
        lines.append('   Model           : Hata (Okumura-Hata)')
        lines.append('   Description     : Urban area model')
    lines.append('')
    lines.append('   IMT Parameters   : cell_radius, antenna_height, antenna_gain, max_eirp')
    lines.append('   Standard         : ITU-R SM.1047 — sufficient for spectrum coordination')
    lines.append('                      at 4.8–5.0 GHz')
    lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 4: PHASE 1 — DETAILED CALCULATION
    # ═══════════════════════════════════════════
    if len(pair_results) > 0:
        lines.append('─── 4. PHASE 1: DETAILED INTERFERENCE CALCULATION ──────────────')
        lines.append(f'   Total pairs computed: {len(pair_results)}')
        lines.append('')

        all_dirs2 = ['IMT→FS', 'IMT→FS_ADJACENT', 'FS→IMT', 'FS→IMT_ADJACENT',
                      'IMT↔IMT_COCHANNEL', 'IMT↔IMT_ADJACENT']
        dir_labels2 = {
            'IMT→FS': '➀ IMT→FS (New IMT interferes with FS receiver)',
            'IMT→FS_ADJACENT': '➀b IMT→FS ADJACENT (ACLR out-of-band emission)',
            'FS→IMT': '➁ FS→IMT (FS transmitter interferes with new IMT)',
            'FS→IMT_ADJACENT': '➁b FS→IMT ADJACENT (FS spill-over to adjacent)',
            'IMT↔IMT_COCHANNEL': '➂/➃ IMT↔IMT CO-CHANNEL (bidirectional)',
            'IMT↔IMT_ADJACENT': 'IMT↔IMT ADJACENT (guard band protection)',
        }

        for d in all_dirs2:
            dir_results = [pr for pr in pair_results if _pr_dir(pr) == d]
            if len(dir_results) == 0:
                continue

            lines.append(f'   === {dir_labels2.get(d, d)} ===')
            lines.append(f'   Pairs: {len(dir_results)}')
            lines.append('')

            for i, pr in enumerate(dir_results):
                lines.append(f'   {i+1}. {_pr_interferer(pr)} → {_pr_victim(pr)}')
                lines.append(f'      Verdict     : {_pr_verdict(pr)}')
                lines.append(f'      Eff. Dist   : {_pr_dist(pr):.0f} m')

                i_dbm = _pr_i(pr)
                pl_db = _pr_pl(pr)
                margin = _pr_margin(pr)
                thresh = _pr_threshold(pr)

                if d == 'IMT→FS':
                    lines.append('      I = EIRP_IMT − PL(d,f) + G_RX_FS − sector_disc')
                    lines.append(f'        = {max_eirp:.1f} − {pl_db:.1f} + G_RX − disc')
                    lines.append(f'        ≈ {i_dbm:.1f} dBm')
                elif d == 'IMT→FS_ADJACENT':
                    lines.append('      I = EIRP − PL + G_RX − disc − ACS(33) − ACLR(45) − guard_iso')
                    lines.append(f'        ≈ {i_dbm:.1f} dBm')
                    lines.append('      Isolation: ACS 33 + ACLR 45 = 78 dB base')
                elif d == 'FS→IMT':
                    lines.append('      I = FS_EIRP − PL(d,f) + G_IMT − beam_disc(F.699) − bldg_loss')
                    lines.append(f'        = FS_EIRP − {pl_db:.1f} + {antenna_gain:.0f} − beam − bl')
                    lines.append(f'        ≈ {i_dbm:.1f} dBm')
                elif d == 'FS→IMT_ADJACENT':
                    lines.append('      I = FS_EIRP − PL + G_IMT − beam − bl − ACS(33) − ACLR(45)')
                    lines.append(f'        ≈ {i_dbm:.1f} dBm')
                elif d == 'IMT↔IMT_COCHANNEL':
                    lines.append('      I = EIRP_int − PL + G_vic − sect_disc − bl(if victim=NEW)')
                    lines.append(f'        ≈ {i_dbm:.1f} dBm')
                    detail = _pr_detail(pr)
                    if detail:
                        lines.append(f'      {detail}')
                elif d == 'IMT↔IMT_ADJACENT':
                    lines.append('      I = EIRP − PL + G − ACS(33) − ACLR(45) − guard_iso')
                    lines.append(f'        ≈ {i_dbm:.1f} dBm')
                    detail = _pr_detail(pr)
                    if detail:
                        lines.append(f'      {detail}')

                lines.append(f'      Margin: I − th = {i_dbm:.1f} − {thresh:.0f} = {margin:.1f} dB')
                lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 4.5: F.699 BEAM ANALYSIS
    # ═══════════════════════════════════════════
    fs_beam_pairs = [pr for pr in pair_results
                     if _pr_dir(pr) in ('FS→IMT', 'FS→IMT_ADJACENT')]
    if fs_beam_pairs:
        lines.append('   --- FS→IMT Beam Analysis (ITU-R F.699) ---')
        for i, pr in enumerate(fs_beam_pairs):
            # Find matching pair for beam status
            dir_key = _pr_dir(pr)
            iname = _pr_interferer(pr).replace(' (FS_LINK)', '').replace(' (FS)', '')
            matching = [p for p in pairs
                        if getattr(p, 'direction', '') == dir_key
                        and getattr(p, 'interferer_name', '') == iname]
            within_beam = None
            if matching:
                within_beam = getattr(matching[0], 'within_beam', None)
            beam_status = 'IN main beam (F.699 G_max)' if within_beam else 'OUTSIDE main beam (-25 dB F.699 side-lobe)'
            lines.append(f'   {i+1}. {_pr_interferer(pr)}: {beam_status} | I={_pr_i(pr):.1f} dBm | PL={_pr_pl(pr):.1f} dB')
        lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 5: GUARD BAND ISOLATION FORMULA
    # ═══════════════════════════════════════════
    guard_blocks = [b for b in gray if 'Guard band' in _reason(b)]
    guard_pairs = [pr for pr in pair_results if _pr_verdict(pr) == 'GUARD_BAND']
    lines.append('─── 5. GUARD BAND ISOLATION FORMULA ─────────────────────────────')
    lines.append(f'   Guard bands     : {len(guard_blocks)} block(s), {len(guard_pairs)} pair(s)')
    if len(guard_blocks) > 0:
        for b in guard_blocks:
            freq_str = f'{_freq(b):.0f}-{_freq(b)+10:.0f}'
            reason = _reason(b)
            lines.append(f'   {freq_str} MHz: {reason}')
        lines.append('')

        lines.append('   === GUARD BAND ISOLATION FORMULA ===')
        lines.append('   ACS (receiver)       : 33 dB  (3GPP TS 38.104)')
        lines.append('   ACLR (BS transmitter) : 45 dB  (3GPP TS 38.104 §6.6.3)')
        lines.append('   Filter roll-off: 12 dB in first 10 MHz, then 15 dB per 10 MHz')
        lines.append('')
        lines.append('   guard_band_isolation_db(guard_mhz):')
        lines.append('     if guard <= 0:  return 33 (ACS only)')
        lines.append('     if guard <= 10: return 33 + guard/10 x 12')
        lines.append('     if guard > 10: return 33 + 12 + (guard-10)/10 x 15')
        lines.append('')
        lines.append('   Principle: isolation(dB) = ACS 33 + filter_roll_off(guard_width)')
        lines.append('   distance = co-channel / 10^(isolation/20)')
        lines.append('   Reference: 3GPP TS 38.104 NR base station ACLR/ACS requirements')
        lines.append('')
    else:
        lines.append('   No guard bands required.')
    lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 5.5: TRADE-OFF ANALYSIS
    # ═══════════════════════════════════════════
    if tradeoff:
        t = tradeoff
        lines.append('─── 5.5 TRADE-OFF ANALYSIS ─────────────────────────────────────')
        lines.append(f'   Resolution type : {t.get("resolution_type", "N/A")}')
        if t.get('resolution_type') != 'relocation_required':
            lines.append(f'   EIRP            : {t.get("original_eirp_dbm")} → {t.get("suggested_eirp_dbm")} dBm')
            pct = t.get('radius_reduction_pct', 0)
            sign = '-' if pct > 0 else ''
            lines.append(f'   Radius          : {t.get("original_radius_m")}m → {t.get("suggested_radius_m")}m ({sign}{pct}%)')
            conflicting = t.get('conflicting_systems', [])
            if conflicting:
                lines.append(f'   Conflicting     : {", ".join(conflicting)}')
        lines.append(f'   {t.get("message", "")}')
        lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 5.8: PHASE 2 — AGGREGATION
    # ═══════════════════════════════════════════
    blocks_with_i = [b for b in blocks if _i_dbm(b) is not None and _i_dbm(b) > -200]
    if blocks_with_i:
        worst = max(blocks_with_i, key=lambda b: _i_dbm(b) or -200)
        if worst and _i_dbm(worst) and _i_dbm(worst) > -200:
            lines.append('─── 5.8 PHASE 2: AGGREGATION (worst case) ──────────────────────')
            f_low = _freq(worst)
            lines.append(f'   Block {f_low:.0f}-{f_low+10:.0f} MHz:')
            lines.append('   Formula: I_total = 10·log10( SUM 10^(I_pair/10) )')
            lines.append('')

            # Find contributing pairs
            b_pairs = []
            for pr in pair_results:
                if hasattr(pr, 'pair'):
                    plow = getattr(pr.pair, 'freq_overlap_low', 0)
                    phigh = getattr(pr.pair, 'freq_overlap_high', 0)
                else:
                    pdata = pr.get('pair', {}) if isinstance(pr, dict) else {}
                    plow = pdata.get('freq_overlap_low', 0)
                    phigh = pdata.get('freq_overlap_high', 0)
                if plow < f_low + 10 and f_low < phigh:
                    b_pairs.append(pr)

            if b_pairs:
                lines.append('   Contributing pairs:')
                for i, pr in enumerate(b_pairs):
                    i_val = _pr_i(pr)
                    i_lin = 10 ** (i_val / 10)
                    lines.append(f'     {i+1}. {_pr_interferer(pr)} -> {_pr_victim(pr)}: I={i_val:.1f} dBm -> {i_lin:.2e} W')

                if _i_new(worst) is not None and _i_new(worst) > -200:
                    lines.append(f'   I_total -> New IMT = {_i_new(worst):.1f} dBm')
                if _i_fs(worst) is not None and _i_fs(worst) > -200:
                    lines.append(f'   I_total -> FS = {_i_fs(worst):.1f} dBm')
                if _i_ex(worst) is not None and _i_ex(worst) > -200:
                    lines.append(f'   I_total -> Existing IMT = {_i_ex(worst):.1f} dBm')
            lines.append(f'   Combined I_total = {_i_dbm(worst):.1f} dBm')
            lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 6: FINAL BLOCK ALLOCATION
    # ═══════════════════════════════════════════
    lines.append('─── 6. FINAL BLOCK ALLOCATION ──────────────────────────────────')
    lines.append(f'   Total    : {len(blocks)} blocks (190 MHz)')
    lines.append(f'   Available: {len(green)} ({len(green) * 10} MHz)')
    lines.append(f'   Blocked  : {len(red)} ({len(red) * 10} MHz)')
    lines.append(f'   Guard    : {len(gray)} ({len(gray) * 10} MHz)')
    lines.append('')

    bar = '   ['
    for b in sorted(blocks, key=lambda x: _freq(x)):
        st = _status(b)
        bar += '#' if st == 'green' else ('X' if st == 'red' else '-')
    bar += ']'
    lines.append(bar)
    lines.append('    4800    4850    4900    4950    4990 MHz')
    lines.append('   # = Available   X = Blocked   - = Guard Band')
    lines.append('')

    # Per-victim summary
    if blocks_with_i:
        lines.append('   Aggregate Interference (I_total = 10*log(sum of all interferers)):')
        worst2 = max(blocks_with_i, key=lambda b: _i_dbm(b) or -200)
        lines.append(f'   Worst block (combined): {_freq(worst2):.0f}-{_freq(worst2)+10:.0f} MHz | I_total={_i_dbm(worst2):.1f} dBm')
        lines.append('')

    avail_mhz = len(green) * 10
    pct = (avail_mhz / 190) * 100
    lines.append(f'   RESULT: {avail_mhz} / 190 MHz available ({pct:.1f}%)')
    lines.append(f'   Computation time: {computation_time_ms:.0f} ms')
    lines.append(f'   Response time  : {elapsed_ms:.0f} ms')
    lines.append('')

    # ═══════════════════════════════════════════
    # SECTION 6.5: PHASE 3 — EIRP LIMITS
    # ═══════════════════════════════════════════
    if block_limits:
        lines.append('─── 6.5 PHASE 3: PER-BLOCK MAX EIRP LIMITS ──────────────────────')
        lines.append('   Formula: max_eirp = current_eirp + min(margin across NEW_IMT pairs)')
        lines.append('   Capped at realistic regulatory max')
        lines.append('')

        cap_out = 43
        cap_in = 24
        real_max = cap_in + (cap_out - cap_in) * (1 - indoor_pct / 100)
        lines.append(f'   Realistic max = 24 + (43-24)x(1-{indoor_pct:.0f}/100) = {real_max:.1f} dBm')
        lines.append('')

        green_lims = [bl for bl in block_limits if (
            getattr(bl, 'status', '') == 'green')]
        if green_lims:
            lines.append('   --- GREEN BLOCKS (allocatable) ---')
            for bl in green_lims:
                f_low_bl = getattr(bl, 'freq_low', 0)
                cur = getattr(bl, 'current_eirp_dbm', None)
                mx = getattr(bl, 'max_eirp_dbm', None)
                mg = getattr(bl, 'margin_db', None)
                lim = getattr(bl, 'limiting_factor', None)
                lines.append(f'   {f_low_bl:.0f}-{f_low_bl+10:.0f} MHz:')
                lines.append(f'     EIRP: {cur:.1f}' if cur else '     EIRP: ?' + f' -> max {mx:.1f}' if mx else ' -> max ?' + ' dBm')
                if mg:
                    lines.append(f'     Margin: +{mg:.1f} dB')
                if lim:
                    lines.append(f'     Limit: {lim}')
                lines.append('')

        red_lims = [bl for bl in block_limits if (
            getattr(bl, 'reducible', False))]
        if red_lims:
            lines.append('   --- RED BLOCKS (reducible - reduce power to use) ---')
            for bl in red_lims:
                f_low_bl = getattr(bl, 'freq_low', 0)
                red = getattr(bl, 'required_reduction_db', None)
                max_if = getattr(bl, 'max_eirp_if_reduced_dbm', None)
                lim = getattr(bl, 'limiting_factor', None)
                lines.append(f'   {f_low_bl:.0f}-{f_low_bl+10:.0f} MHz:')
                lines.append(f'     Reduce by: {red:.1f} dB -> {max_if:.1f} dBm' if red and max_if else '     Reduce: ?')
                if lim:
                    lines.append(f'     Limit: {lim}')
                lines.append('')

        nr_lims = [bl for bl in block_limits if (
            getattr(bl, 'status', '') == 'red'
            and not getattr(bl, 'reducible', False))]
        if nr_lims:
            lines.append('   --- RED (non-reducible - reducing power will not help) ---')
            for bl in nr_lims:
                f_low_bl = getattr(bl, 'freq_low', 0)
                reason_bl = getattr(bl, 'reason', 'Interference from other systems')
                lines.append(f'   {f_low_bl:.0f}-{f_low_bl+10:.0f} MHz: {reason_bl}')
            lines.append('')

    # ═══════════════════════════════════════════
    # CLOSING
    # ═══════════════════════════════════════════
    lines.append('═══════════════════════════════════════════════')

    return lines
