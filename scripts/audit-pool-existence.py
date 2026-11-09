#!/usr/bin/env python3
"""Ask the contract, one id at a time, what it actually holds.

getPools() reverts the whole batch if any id is unknown, so a board with even one
phantom id can never be audited in bulk. This walks the manifest and records, per id:
status (1=open, 2=settled, 3=cancelled) or 'notfound'.
"""
import json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

os.environ.setdefault("HTTPS_PROXY", "http://172.17.240.1:16781")
ROOT = "/mnt/c/Users/Administrator/prediction-arena"
A = "0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5"
RPC = os.environ.get("AUDIT_RPC", "https://mainnet.base.org")
CAST = os.path.expanduser("~/.foundry/bin/cast")
SIG = "getPool(uint256)((string,string,uint64,uint8,uint8,uint256,uint256,uint256,bytes32))"

def one(pid):
    try:
        p = subprocess.run([CAST, "call", A, SIG, pid, "--rpc-url", RPC],
                           capture_output=True, text=True, timeout=45)
    except Exception as e:
        return pid, "error:" + str(e)[:40]
    if p.returncode != 0:
        if "PoolNotFound" in p.stderr:
            return pid, "notfound"
        return pid, "error:" + p.stderr.strip().replace("\n", " ")[:60]
    m = re.search(r"\]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*0x", p.stdout)
    return pid, (int(m.group(2)) if m else "parse_fail")

def main():
    d = json.load(open(os.path.join(ROOT, "frontend/public/pools.json")))
    ids = [str(p["id"]) for p in d["pools"]]
    out = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for pid, st in ex.map(one, ids):
            out[pid] = st
    json.dump(out, open("/tmp/chain_status.json", "w"))
    from collections import Counter
    print(len(out), Counter(out.values()))

if __name__ == "__main__":
    main()
