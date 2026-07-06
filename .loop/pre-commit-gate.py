#!/usr/bin/env python3
"""
pre-commit-gate — Mechanical Gate Enforcement
=============================================
บล็อกการเขียนโค้ดจนกว่าจะผ่านทุก gate ก่อนถึง Phase 3 (Execute)

หลักการ: "ถ้ามันสำคัญพอที่จะต้องทำ → มันสำคัญพอที่จะบังคับด้วยโค้ด"

GATES (ต้องผ่าน ≥5/7 ถึงได้ PASS):
  1. Loop Readiness      — loop-gate.py score ≥ 60
  2. Understand-Anything — knowledge-graph.json exists + queried
  3. Graphify            — graphify project queried (ถ้ามี mixed content)
  4. Honcho Probe        — honcho probed ภายใน session นี้
  5. Obsidian Fence      — obsidian-knowledge-graph loaded (ถ้าแก้ไฟล์ใน vault)
  6. L1-Gate             — l1-gate skill loaded ก่อน memory write
  7. Impact Analysis     — Phase 2.5 cascading trace ทำแล้ว

USAGE:
  python3 .loop/pre-commit-gate.py              # interactive (human-readable)
  python3 .loop/pre-commit-gate.py --json       # machine-readable (CI/gates)
  python3 .loop/pre-commit-gate.py --mark GATE  # self-report: mark gate as passed
  python3 .loop/pre-commit-gate.py --reset      # reset all gates for new session

ARCHITECTURE:
  - State file: .loop/.gate-state.json (session_id, gate timestamps, tokens)
  - Gates are SESSION-SCOPED — reset หลัง 30 นาที inactivity
  - Self-reported gates (Honcho, l1-gate, obsidian) → --mark
  - Objective gates (loop-gate, understand graph, graphify) → auto-check

SCORE:
  ≥90 — ALL GATES PASS — ready to execute
  ≥70 — MINIMAL PASS — critical gates passed, minor gaps
  ≥50 — WARNING — some gates missing, proceed with caution
  <50 — BLOCK — execution blocked until gates passed
"""

import os
import sys
import json
import time
import subprocess
from datetime import datetime, timezone

# ── Config ──────────────────────────────────────────────
SESSION_TIMEOUT = 30 * 60  # 30 minutes
MINIMUM_GATES_FOR_PASS = 5  # need ≥5/7 to pass
LOOP_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(LOOP_DIR)
STATE_FILE = os.path.join(LOOP_DIR, ".gate-state.json")

# ── Gate definitions ────────────────────────────────────
GATES = {
    "loop": {
        "name": "Loop Readiness",
        "description": "loop-gate.py score ≥ 60 — project structure intact",
        "weight": 20,
        "objective": True,   # auto-checkable
        "critical": True,    # must pass
    },
    "understand": {
        "name": "Understand-Anything",
        "description": "knowledge-graph.json exists + queried within session",
        "weight": 15,
        "objective": True,
        "critical": False,
    },
    "graphify": {
        "name": "Graphify",
        "description": "graphify project queried for cross-domain analysis",
        "weight": 10,
        "objective": False,  # self-report (variable project path)
        "critical": False,
    },
    "honcho": {
        "name": "Honcho Probe",
        "description": "honcho_search + honcho_context probed this session",
        "weight": 15,
        "objective": False,  # self-report
        "critical": True,
    },
    "obsidian": {
        "name": "Obsidian Fence",
        "description": "obsidian-knowledge-graph loaded (if writing to vault)",
        "weight": 10,
        "objective": False,  # self-report
        "critical": False,
    },
    "l1gate": {
        "name": "L1-Gate",
        "description": "l1-gate skill loaded before any memory write",
        "weight": 15,
        "objective": False,  # self-report
        "critical": True,
    },
    "impact": {
        "name": "Impact Analysis",
        "description": "Phase 2.5 cascading trace completed",
        "weight": 15,
        "objective": False,  # self-report
        "critical": True,
    },
}


# ── State management ────────────────────────────────────
def load_state():
    """โหลด gate state จากไฟล์"""
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {
        "session_id": "",
        "created": "",
        "gates": {k: {"passed": False, "timestamp": "", "detail": ""} for k in GATES},
        "project": os.path.basename(PROJECT_ROOT),
        "loop_score": 0,
    }


def save_state(state):
    """บันทึก gate state ลงไฟล์"""
    state["updated"] = datetime.now(timezone.utc).isoformat()
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def is_session_fresh(state):
    """เช็คว่า session ยัง active อยู่ (<30 นาที)"""
    if not state.get("created"):
        return False
    try:
        created = datetime.fromisoformat(state["created"])
        elapsed = (datetime.now(timezone.utc) - created).total_seconds()
        return elapsed < SESSION_TIMEOUT
    except (ValueError, TypeError):
        return False


def init_session(state):
    """เริ่ม session ใหม่"""
    state["session_id"] = datetime.now().strftime("%Y%m%d-%H%M%S")
    state["created"] = datetime.now(timezone.utc).isoformat()
    state["gates"] = {k: {"passed": False, "timestamp": "", "detail": ""} for k in GATES}
    return state


# ── Objective checks ────────────────────────────────────
def check_loop_gate():
    """Run loop-gate.py and check score"""
    loop_gate_path = os.path.join(LOOP_DIR, "loop-gate.py")
    if not os.path.exists(loop_gate_path):
        return False, 0, "loop-gate.py not found"

    try:
        result = subprocess.run(
            [sys.executable, loop_gate_path, "--json"],
            capture_output=True, text=True, timeout=10
        )
        data = json.loads(result.stdout)
        score = data.get("score", 0)
        passed = score >= 60
        detail = f"Score: {score}/100 — {data.get('level', 'Unknown')}"
        return passed, score, detail
    except Exception as e:
        return False, 0, f"Error: {str(e)[:100]}"


def check_understand_graph():
    """เช็คว่า knowledge-graph.json มีอยู่"""
    graph_path = os.path.join(PROJECT_ROOT, ".understand-anything", "knowledge-graph.json")
    if os.path.exists(graph_path):
        size = os.path.getsize(graph_path)
        mtime = datetime.fromtimestamp(os.path.getmtime(graph_path))
        return True, f"Exists ({size:,} bytes, updated {mtime.strftime('%Y-%m-%d %H:%M')})"
    return False, "No knowledge-graph.json — run 'understand' first"


# ── Self-report (--mark) ────────────────────────────────
def mark_gate(state, gate_id, detail=""):
    """บันทึกว่า gate นี้ผ่านแล้ว"""
    if gate_id not in GATES:
        print(f"❌ Unknown gate: {gate_id}")
        print(f"   Available: {', '.join(GATES.keys())}")
        return

    state["gates"][gate_id] = {
        "passed": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "detail": detail or f"Marked at {datetime.now().strftime('%H:%M:%S')}",
    }
    save_state(state)
    print(f"✅ {GATES[gate_id]['name']}: MARKED — {state['gates'][gate_id]['detail']}")


# ── Main gate evaluation ────────────────────────────────
def evaluate(state):
    """ประเมินทุก gate — คืน (score, passed, results)"""
    results = []
    total_score = 0
    max_score = 0
    critical_fails = []

    for gate_id, gate in GATES.items():
        max_score += gate["weight"]
        gate_state = state["gates"].get(gate_id, {})

        # Objective checks
        if gate["objective"]:
            if gate_id == "loop":
                passed, loop_score, detail = check_loop_gate()
                state["loop_score"] = loop_score
            elif gate_id == "understand":
                passed, detail = check_understand_graph()
            else:
                passed, detail = False, "Unknown objective gate"

            # Update state
            state["gates"][gate_id] = {
                "passed": passed,
                "timestamp": datetime.now(timezone.utc).isoformat() if passed else "",
                "detail": detail,
            }
        else:
            # Self-reported gate
            passed = gate_state.get("passed", False)
            detail = gate_state.get("detail", "Not yet marked")

        points = gate["weight"] if passed else 0
        total_score += points

        results.append({
            "gate": gate_id,
            "name": gate["name"],
            "weight": gate["weight"],
            "passed": passed,
            "points": points,
            "detail": detail,
            "critical": gate["critical"],
            "type": "objective" if gate["objective"] else "self-report",
        })

        if gate["critical"] and not passed:
            critical_fails.append(gate["name"])

    # Determine level
    gates_passed = sum(1 for r in results if r["passed"])
    all_critical_ok = len(critical_fails) == 0

    if total_score >= 90 and all_critical_ok:
        level = "🟢 ALL GATES PASS — Ready to Execute"
        recommendation = "Proceed to Phase 3 (Execute). All gates verified."
    elif total_score >= 70 and all_critical_ok:
        level = "🟡 MINIMAL PASS — Minor Gaps"
        recommendation = "Proceed with caution. Non-critical gates missing."
    elif total_score >= 50:
        level = "🟠 WARNING — Critical Gates Missing"
        recommendation = f"Fix before executing: {', '.join(critical_fails)}"
    else:
        level = "🔴 BLOCKED — Execution Not Allowed"
        recommendation = f"MUST fix: {', '.join(critical_fails)}"

    save_state(state)

    return {
        "project": state["project"],
        "session_id": state["session_id"],
        "score": total_score,
        "max_score": max_score,
        "gates_passed": gates_passed,
        "total_gates": len(GATES),
        "level": level,
        "recommendation": recommendation,
        "critical_fails": critical_fails,
        "results": results,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── Display ─────────────────────────────────────────────
def display_human(eval_result):
    """แสดงผลแบบ human-readable"""
    print()
    print("╔══════════════════════════════════════════════╗")
    print("║  🔐 PRE-COMMIT GATE — Mechanical Enforcement  ║")
    print("╚══════════════════════════════════════════════╝")
    print(f"  Project: {eval_result['project']}")
    print(f"  Session: {eval_result['session_id']}")
    print()

    for r in eval_result["results"]:
        icon = "✅" if r["passed"] else "❌"
        critical_marker = " 🔴CRITICAL" if r["critical"] and not r["passed"] else ""
        type_marker = "[auto]" if r["type"] == "objective" else "[self]"
        print(f"  {icon} {r['name']} ({r['points']}/{r['weight']}pts){critical_marker} {type_marker}")
        print(f"     {r['detail']}")

    print()
    score_pct = (eval_result["score"] / eval_result["max_score"] * 100) if eval_result["max_score"] > 0 else 0
    print(f"  📊 Score: {eval_result['score']}/{eval_result['max_score']} ({score_pct:.0f}%) — {eval_result['gates_passed']}/{eval_result['total_gates']} gates")
    print(f"  {eval_result['level']}")
    print(f"  → {eval_result['recommendation']}")

    if eval_result["critical_fails"]:
        print()
        print(f"  🔴 CRITICAL GATES FAILED: {', '.join(eval_result['critical_fails'])}")
        print(f"  ACTION: Fix before proceeding to Phase 3 (Execute)")
        print()
        print(f"  Quick fixes:")
        if "Honcho Probe" in eval_result["critical_fails"]:
            print(f"    python3 .loop/pre-commit-gate.py --mark honcho")
        if "L1-Gate" in eval_result["critical_fails"]:
            print(f"    python3 .loop/pre-commit-gate.py --mark l1gate")
        if "Impact Analysis" in eval_result["critical_fails"]:
            print(f"    python3 .loop/pre-commit-gate.py --mark impact")

    print()
    return eval_result["score"]


# ── Main ────────────────────────────────────────────────
def main():
    state = load_state()

    # --reset: เริ่ม session ใหม่
    if "--reset" in sys.argv:
        state = init_session(state)
        save_state(state)
        print(f"🔄 Session reset: {state['session_id']}")
        print("   All gates cleared. Ready for new session.")
        return

    # --mark GATE: self-report gate pass
    if "--mark" in sys.argv:
        idx = sys.argv.index("--mark")
        if idx + 1 < len(sys.argv):
            gate_id = sys.argv[idx + 1]
            detail = " ".join(sys.argv[idx + 2:]) if idx + 2 < len(sys.argv) else ""
            mark_gate(state, gate_id, detail)
        else:
            print("Usage: pre-commit-gate.py --mark <gate_id> [detail]")
            print(f"Available gates: {', '.join(GATES.keys())}")
        return

    # ตรวจสอบ session freshness
    if not is_session_fresh(state):
        state = init_session(state)
        save_state(state)

    # Evaluate
    eval_result = evaluate(state)

    # Output
    if "--json" in sys.argv:
        print(json.dumps(eval_result, indent=2, ensure_ascii=False))
    else:
        score = display_human(eval_result)

    # Exit code: 0 if score >= 50 (warning threshold), 1 if blocked
    sys.exit(0 if eval_result["score"] >= 50 else 1)


if __name__ == "__main__":
    main()
