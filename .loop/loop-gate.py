#!/usr/bin/env python3
"""loop-gate — Universal Loop Readiness Check

ใช้กับทุกโปรเจค — เช็คว่า .loop/ structure ครบถ้วนก่อนเริ่มงาน
ต้องมี .loop/config.json กำหนด project-specific checks

USAGE:
  python3 .loop/loop-gate.py          # human-readable
  python3 .loop/loop-gate.py --json   # machine-readable (CI/gates)

SCORE:
  ≥80 — L3 Production Loop (autonomous execution)
  ≥60 — L2 Guarded Loop (context exists, services optional)
  ≥30 — L1 Basic Loop (some files missing)
  <30 — L0 Not Ready (BLOCK execution)

PROJECT CONFIG (.loop/config.json):
{
  "project": "MyProject",
  "services": [
    {"name": "backend", "port": 8001, "path": "/api/health"},
    {"name": "frontend", "port": 5173}
  ],
  "checks": {
    "git_enabled": true,
    "services_enabled": true
  }
}
"""

import os
import sys
import json
from datetime import datetime

def get_project_root():
    """หา project root — directory ที่มี .loop/"""
    loop_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(loop_dir)

def load_config(loop_dir):
    """โหลด .loop/config.json"""
    config_path = os.path.join(loop_dir, "config.json")
    if os.path.exists(config_path):
        with open(config_path) as f:
            return json.load(f)
    return {}

def check_file(loop_dir, filename, min_size=100):
    """เช็คว่าไฟล์มีอยู่และมีขนาด > min_size"""
    path = os.path.join(loop_dir, filename)
    exists = os.path.exists(path)
    size = os.path.getsize(path) if exists else 0
    return exists and size > min_size, size

def check_git(project_root):
    """เช็คว่ามี git commit ล่าสุด"""
    import subprocess
    try:
        result = subprocess.run(
            ["git", "log", "--oneline", "-1", "--format=%H %s"],
            cwd=project_root, capture_output=True, text=True, timeout=5
        )
        return result.returncode == 0 and bool(result.stdout.strip()), result.stdout.strip()[:80]
    except Exception:
        return False, ""

def check_service(name, port, health_path=None):
    """เช็คว่า service ตอบสนอง"""
    import urllib.request
    url = f"http://localhost:{port}{health_path or ''}"
    try:
        req = urllib.request.Request(url)
        resp = urllib.request.urlopen(req, timeout=3)
        return resp.status == 200, f"HTTP {resp.status}"
    except Exception as e:
        return False, str(e)[:80]

def run(json_mode=False):
    loop_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = get_project_root()
    config = load_config(loop_dir)
    project_name = config.get("project", os.path.basename(project_root))
    checks_config = config.get("checks", {})
    services_config = config.get("services", [])
    
    results = []
    score = 0
    
    # ── Step 1: Required files (60 points: 15 each) ──
    required_files = {
        "context.md": "Project structure, stack, services, key files",
        "conventions.md": "Coding standards, naming, terminology",
        "pitfalls.md": "Known pitfalls and verification commands",
        "state.md": "Current phase, git commit, service status",
    }
    
    for filename, description in required_files.items():
        ok, size = check_file(loop_dir, filename)
        points = 15 if ok else 0
        score += points
        results.append({
            "check": f"file:{filename}",
            "status": "pass" if ok else "fail",
            "detail": description,
            "size_bytes": size,
            "points": points,
        })
        if not json_mode:
            icon = "✅" if ok else "❌"
            print(f"  {icon} {filename} ({size} bytes) — {description}")
    
    # ── Step 2: Git activity (20 points) ──
    if checks_config.get("git_enabled", True):
        ok, detail = check_git(project_root)
        points = 20 if ok else 0
        score += points
        results.append({
            "check": "git:recent_commit",
            "status": "pass" if ok else "fail",
            "detail": detail,
            "points": points,
        })
        if not json_mode:
            icon = "✅" if ok else "❌"
            print(f"  {icon} git: {'recent commit' if ok else 'no commit'} — {detail[:60]}")
    else:
        results.append({"check": "git:recent_commit", "status": "skip", "detail": "disabled in config"})
        if not json_mode:
            print("  ⏭️  git: disabled in .loop/config.json")
    
    # ── Step 3: Services (20 points, distributed) ──
    if services_config and checks_config.get("services_enabled", True):
        points_per_service = 20 / len(services_config) if services_config else 0
        for svc in services_config:
            name = svc.get("name", "unknown")
            port = svc.get("port")
            health = svc.get("path")
            ok, detail = check_service(name, port, health)
            points = round(points_per_service) if ok else 0
            score += points
            results.append({
                "check": f"service:{name}",
                "status": "pass" if ok else ("warn" if "refused" in detail.lower() else "fail"),
                "detail": f"port {port} — {detail}",
                "points": points,
            })
            if not json_mode:
                icon = "✅" if ok else "⚠️"
                print(f"  {icon} service: {name} (port {port}) — {detail}")
    elif not services_config:
        results.append({"check": "services", "status": "skip", "detail": "no services configured"})
        if not json_mode:
            print("  ⏭️  services: none configured in .loop/config.json")
    
    # ── Level determination ──
    if score >= 80:
        level = "L3 (Production Loop)"
        assessment = f"{project_name}: All gates pass — ready for autonomous execution."
    elif score >= 60:
        level = "L2 (Guarded Loop)"
        assessment = f"{project_name}: Context + conventions exist. Services may be optional."
    elif score >= 30:
        level = "L1 (Basic Loop)"
        assessment = f"{project_name}: Some files missing. Run: mkdir .loop && touch .loop/{{context,conventions,pitfalls,state}}.md"
    else:
        level = "L0 (Not Ready)"
        assessment = f"{project_name}: Missing critical loop files. BLOCK execution until fixed."
    
    output = {
        "target": project_root,
        "project": project_name,
        "score": score,
        "level": level,
        "assessment": assessment,
        "timestamp": datetime.now().isoformat(),
        "checks": results,
    }
    
    if json_mode:
        print(json.dumps(output, indent=2, ensure_ascii=False))
    else:
        print(f"\n  🏗️  {project_name} — Loop Ready: {score}/100 — {level}")
        print(f"  {assessment}")
    
    return score

if __name__ == "__main__":
    json_mode = "--json" in sys.argv
    score = run(json_mode=json_mode)
    sys.exit(0 if score >= 60 else 2)
