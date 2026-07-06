#!/usr/bin/env python3
"""loop-gate — PAFC Loop Readiness Check

เช็คว่า .loop/ structure ครบถ้วนก่อนเริ่มงาน
ใช้แทน loop-audit (ซึ่งคาดหวัง file structure คนละแบบ)

Usage:
  python3 .loop/loop-gate.py          # human-readable
  python3 .loop/loop-gate.py --json   # machine-readable (for CI/gates)
"""

import os
import sys
import json
from datetime import datetime

LOOP_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(LOOP_DIR)

CHECKS = {
    "context.md": "Project structure, stack, services, key files",
    "conventions.md": "Coding standards, NBTC colors, Thai terminology",
    "pitfalls.md": "Known pitfalls (102 from pafc-project skill)",
    "state.md": "Current phase, git commit, service status",
}

def run(json_mode=False):
    results = []
    score = 0
    max_score = 100
    
    # File existence checks (60 points)
    for filename, description in CHECKS.items():
        path = os.path.join(LOOP_DIR, filename)
        exists = os.path.exists(path)
        size = os.path.getsize(path) if exists else 0
        if json_mode:
            results.append({
                "check": f"loop_file:{filename}",
                "status": "pass" if exists and size > 100 else "fail",
                "detail": description,
                "size_bytes": size,
            })
        else:
            icon = "✅" if exists and size > 100 else "❌"
            print(f"  {icon} {filename} ({size} bytes) — {description}")
        if exists and size > 100:
            score += 15
    
    # Git activity check (20 points)
    import subprocess
    try:
        result = subprocess.run(
            ["git", "log", "--oneline", "-1", "--format=%H %s"],
            cwd=PROJECT_DIR, capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            score += 20
            if json_mode:
                results.append({"check": "git:recent_commit", "status": "pass", "detail": result.stdout.strip()[:80]})
            else:
                print(f"  ✅ git: recent commit — {result.stdout.strip()[:60]}")
        else:
            if json_mode:
                results.append({"check": "git:recent_commit", "status": "fail"})
            else:
                print("  ❌ git: no recent commit")
    except Exception:
        if json_mode:
            results.append({"check": "git:recent_commit", "status": "fail"})
        else:
            print("  ❌ git: not accessible")
    
    # Services check (20 points) — check if backend is responding
    try:
        import urllib.request
        req = urllib.request.Request("http://localhost:8001/api/health")
        resp = urllib.request.urlopen(req, timeout=3)
        if resp.status == 200:
            score += 10
            if json_mode:
                results.append({"check": "service:backend", "status": "pass", "detail": "port 8001 responding"})
            else:
                print("  ✅ service: backend (port 8001) — health check OK")
        else:
            if json_mode:
                results.append({"check": "service:backend", "status": "fail", "detail": f"HTTP {resp.status}"})
            else:
                print(f"  ⚠️  service: backend — HTTP {resp.status}")
    except Exception:
        if json_mode:
            results.append({"check": "service:backend", "status": "warn", "detail": "not reachable (may be intentional)"})
        else:
            print("  ⚠️  service: backend — not reachable (may be intentional)")
    
    try:
        import urllib.request
        req = urllib.request.Request("http://localhost:5173")
        resp = urllib.request.urlopen(req, timeout=3)
        if resp.status == 200:
            score += 10
            if json_mode:
                results.append({"check": "service:frontend", "status": "pass", "detail": "port 5173 responding"})
            else:
                print("  ✅ service: frontend (port 5173) — dev server running")
        else:
            if json_mode:
                results.append({"check": "service:frontend", "status": "fail", "detail": f"HTTP {resp.status}"})
            else:
                print(f"  ⚠️  service: frontend — HTTP {resp.status}")
    except Exception:
        if json_mode:
            results.append({"check": "service:frontend", "status": "warn", "detail": "not reachable (may be intentional)"})
        else:
            print("  ⚠️  service: frontend — not reachable (may be intentional)")
    
    # Level determination
    if score >= 80:
        level = "L3 (Production Loop)"
        assessment = "All gates pass — ready for autonomous execution."
    elif score >= 60:
        level = "L2 (Guarded Loop)"
        assessment = "Context + conventions exist. Services may be optional."
    elif score >= 30:
        level = "L1 (Basic Loop)"
        assessment = "Some files missing. Run: mkdir .loop && touch .loop/context.md ..."
    else:
        level = "L0 (Not Ready)"
        assessment = "Missing critical loop files. Block execution."
    
    output = {
        "target": PROJECT_DIR,
        "score": score,
        "level": level,
        "assessment": assessment,
        "timestamp": datetime.now().isoformat(),
        "checks": results,
    }
    
    if json_mode:
        print(json.dumps(output, indent=2, ensure_ascii=False))
    else:
        print(f"\n  Loop Ready: {score}/100 — {level}")
        print(f"  {assessment}")
    
    return score

if __name__ == "__main__":
    json_mode = "--json" in sys.argv
    score = run(json_mode=json_mode)
    sys.exit(0 if score >= 60 else 2)
