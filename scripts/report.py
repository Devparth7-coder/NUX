"""Formatters for scripts/acceptance.sh — keeps shell quoting simple."""

import json
import sys


def load():
    return json.load(sys.stdin)


def intent_id():
    print(load()["intentId"])


def run_id():
    print(load()["runId"])


def started():
    d = load()
    intent = d["intent"]
    print("  objective     :", intent["objective"])
    print("  deadline      :", intent["deadlineText"], "->", intent["deadline"])
    print("  confidence    :", intent["confidence"])
    print("  project       :", (intent["projectContext"] or {}).get("name"))
    print("  capabilities  :", ", ".join(intent["requiredCapabilities"]))
    print("  permissions   :", ", ".join(intent["permissionsRequired"]))
    print("  context items :", d["context"]["items"], "confidence", d["context"]["confidence"])
    print("  graph         :", " -> ".join(s["agent"] for s in d["graph"]))


def status():
    d = load()
    print(d["runs"][0]["status"])


def approvals():
    d = load()
    for a in d["approvals"]:
        print("  [%s] %s" % (a["permissionLevel"], a["title"]))
        print("      why :", a["whyNeeded"])
        print("      tool:", a["toolKey"])
    print("  approvals: %d | pending: %d" % (len(d["approvals"]), sum(1 for a in d["approvals"] if a["status"] == "PENDING")))


def approved():
    print("  approved:", load()["approved"], "action(s)")


def result():
    d = load()
    r = d.get("result")
    if not r:
        print("   NO RESULT YET")
        return
    print("   %s" % r["headline"])
    print("   %s" % r["summary"])
    print(
        "   tasks: %d (open %d, done %d, scheduled %d) | recommendations: %d | approvals: %d (approved %d, denied %d)"
        % (
            r["tasks"]["total"],
            r["tasks"]["open"],
            r["tasks"]["completed"],
            r["tasks"]["scheduled"],
            len(r["recommendations"]),
            r["approvals"]["total"],
            r["approvals"]["approved"],
            r["approvals"]["denied"],
        )
    )
    for rec in r["recommendations"]:
        print("     - %s — %s" % (rec["title"], rec["detail"][:110]))
    print("   evidence findings: %d" % len(r["findings"]))
    print(
        "   memories: %d | artifacts: %d | agent runs: %d | tool calls: %d | duration: %.1fs"
        % (len(r["memories"]), len(r["artifacts"]), r["agentRuns"], r["toolCalls"], r["durationMs"] / 1000)
    )


def projects():
    for p in load()["projects"]:
        print("   %s: health=%s progress=%d%% tasks=%d" % (p["name"], p["health"], p["progress"], p["counts"]["tasks"]))


def timeline():
    for event in load()["timeline"][-12:]:
        print("   %s  %-22s %s" % (event["at"][11:19], event["kind"], event["message"]))


if __name__ == "__main__":
    globals()[sys.argv[1]]()
