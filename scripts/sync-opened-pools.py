#!/usr/bin/env python3
"""Write scripts/opened-pools.json from on-chain truth.

The manifest's generated rows are rebuilt every 30 minutes; the pools they describe are permanent
contract state. This script is the bridge: for every id in public/pools.json it asks the contract
what exists, and records the ones that do. gen-board then emits those rows as `source: "chain"`
instead of `demo`, which is what makes the USDC rail live on the site.

Run after the opener (cron 10,40), before gen-board consumers rebuild.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POOLS = os.path.join(ROOT, "frontend", "public", "pools.json")
OUT = os.path.join(ROOT, "scripts", "opened-pools.json")

env = {}
with open(os.path.join(ROOT, ".env")) as fh:
    for line in fh:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k] = v.strip().strip('"').strip("'")

arena = env["ARENA_ADDRESS"]
rpc = env["BASE_RPC_URL"]
cast = os.path.expanduser("~/.foundry/bin/cast")
if not os.path.exists(cast):
    cast = "cast"

pools = json.load(open(POOLS))["pools"]
prev = {}
if os.path.exists(OUT):
    try:
        prev = json.load(open(OUT))
    except Exception:
        prev = {}

opened = {}
for p in pools:
    pid = str(p.get("id", ""))
    if not pid.isdigit():
        continue
    try:
        out = subprocess.run(
            [cast, "call", arena, "getPool(uint256)((string,string,uint64,uint8,uint8,uint256,uint256,uint256,bytes32))", pid,
             "--rpc-url", rpc],
            capture_output=True, text=True, timeout=45,
        )
    except subprocess.TimeoutExpired:
        print(f"{pid}: rpc timeout", file=sys.stderr)
        continue
    if out.returncode != 0 or "Error" in (out.stdout + out.stderr):
        continue
    # ("title", "Category", 1793491199 [1.79e9], 0, 1, ...)
    import re
    m = re.match(r'\(\s*"(.*?)"\s*,\s*"(.*?)"\s*,\s*(\d+)', out.stdout.strip())
    if not m:
        print(f"{pid}: unparsable getPool output", file=sys.stderr)
        continue
    title, category, end_ts = m.group(1), m.group(2), int(m.group(3))
    import datetime
    opened[pid] = {
        "id": pid,
        "title": title,
        "category": category,
        "endTimeUtc": datetime.datetime.fromtimestamp(end_ts, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "tx": (prev.get(pid) or {}).get("tx"),
    }

json.dump(opened, open(OUT, "w"), indent=2, ensure_ascii=False)
print(f"opened pools on chain: {len(opened)} -> {os.path.relpath(OUT, ROOT)}")
