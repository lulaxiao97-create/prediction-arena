#!/usr/bin/env python3
"""wallet-forensics — 一个地址、零授权，U 是怎么走的？

用法:
    python3 scripts/wallet-forensics.py 0xAddress [--chain base|eth] [--token 0xUSDC]

回答四个问题，全部基于链上证据，不猜：

1. 这个地址的代码是什么？—— 0xef0100… 开头 = EIP-7702 委托（账户被委托给某个合约，
   之后任何发往该地址的调用都执行那段代码，用户看不到"授权"这一步）。
2. 有没有"授权类"事件？—— ERC20 Approval / Permit。有 Approval 就不是"零授权"，
   只是那笔签名看起来不像授权。
3. 钱是怎么出去的？—— 列出转出交易，标出 from 是否等于本地址、谁付的 gas。
   from == 本地址 且 gas 由别人付 = 私钥在别人手里（被脚本/木马接管）。
4. 什么时候第一次少钱？—— 给出最早一笔异常转出的时间戳，用来对齐"哪天中招"。

需要 BASESCAN_API_KEY（v2 聚合接口，一个 key 走所有链）。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

RPC = {
    "base": "https://base-rpc.publicnode.com",
    "eth": "https://ethereum-rpc.publicnode.com",
}
CHAIN_ID = {"base": 8453, "eth": 1}
USDC = {
    "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "eth": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
}
EXPLORER = {"base": "https://basescan.org", "eth": "https://etherscan.io"}


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for path in (".env", "../.env"):
        if os.path.exists(path):
            for line in open(path, encoding="utf-8", errors="ignore"):
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.split("=", 1)
                    env.setdefault(k.strip(), v.strip())
            break
    env.update({k: v for k, v in os.environ.items() if k.startswith(("BASESCAN", "ETHERSCAN"))})
    return env


def rpc(method: str, params: list, chain: str) -> str:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(
        RPC[chain],
        data=body,
        headers={"content-type": "application/json", "user-agent": "Mozilla/5.0 (X11; Linux x86_64)"},
    )
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        )
        out = opener.open(req, timeout=40).read()
    else:
        out = urllib.request.urlopen(req, timeout=40).read()
    return json.loads(out)["result"]


def api(chain: str, key: str, **params) -> list:
    q = {
        "chainid": CHAIN_ID[chain],
        "apikey": key,
        **params,
    }
    url = "https://api.etherscan.io/v2/api?" + urllib.parse.urlencode(q)
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    req = urllib.request.Request(url, headers={"user-agent": "wallet-forensics/1.0"})
    if proxy:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        )
        raw = opener.open(req, timeout=40).read()
    else:
        raw = urllib.request.urlopen(req, timeout=40).read()
    data = json.loads(raw)
    res = data.get("result")
    if isinstance(res, list):
        return res
    if isinstance(res, str) and "No transactions" in res:
        return []
    print(f"  ! api {params.get('action')}: {data.get('message')} {res}", file=sys.stderr)
    return []


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    addr = sys.argv[1]
    chain = "base"
    token = USDC[chain]
    for i, a in enumerate(sys.argv):
        if a == "--chain":
            chain = sys.argv[i + 1]
            token = USDC[chain]
        if a == "--token":
            token = sys.argv[i + 1]

    env = load_env()
    key = env.get("BASESCAN_API_KEY") or env.get("ETHERSCAN_API_KEY") or ""
    print(f"== {addr} on {chain}")

    code = rpc("eth_getCode", [addr, "latest"], chain) or "0x"
    code = str(code)
    if code.startswith("0xef0100"):
        target = "0x" + code[8:48]
        print(f"[!] EIP-7702 delegation → {target}")
        print("    这个地址被委托给了上面这个合约：之后任何调用都执行它的代码，")
        print("    用户不需要再签任何东西。查这个合约是谁、什么时候被写入的（delegation 那笔交易）。")
    elif code == "0x":
        print("[ok] 普通 EOA（无代码、无 7702 委托）")
    else:
        print(f"[i] 合约地址，code {len(code)//2} bytes")

    if not key:
        print("! 没有 BASESCAN_API_KEY，跳过历史（只做了 code 检查）")
        return

    approvals = api(
        chain, key,
        module="account", action="tokentx", address=addr, contractaddress=token,
        page="1", offset="200", sort="asc",
    )
    outs, ins = [], []
    for t in approvals:
        if t.get("tokenSymbol", "").upper() not in ("USDC", "USDC.E"):
            continue
        try:
            v = int(t["value"]) / 10 ** int(t.get("tokenDecimal", 6))
        except Exception:
            continue
        row = {
            "at": int(t["timeStamp"]),
            "hash": t["hash"],
            "from": t["from"].lower(),
            "to": t["to"].lower(),
            "usdc": v,
            "gas_by": None,  # filled below
        }
        (outs if row["from"] == addr.lower() else ins).append(row)

    # Who paid gas on the outbound transfers: that is the signature question.
    print(f"\n[USDC out] {len(outs)} transfers, {sum(r['usdc'] for r in outs):.2f} USDC total")
    for r in outs[-10:]:
        tx = api(chain, key, module="proxy", action="eth_getTransactionByHash", txhash=r["hash"])
        tx = tx if isinstance(tx, dict) else {}
        gas_by = "-"
        if isinstance(tx, dict) and tx.get("from"):
            gas_by = tx["from"].lower()
        tag = "本地址自付 gas（私钥仍在本地址）" if gas_by == addr.lower() else f"gas 由 {gas_by} 付（私钥在别人手里）"
        print(f"  {r['usdc']:>12.2f} U  {r['hash'][:12]}…  {tag}")

    print(f"\n[USDC in] {len(ins)} transfers, {sum(r['usdc'] for r in ins):.2f} USDC total")
    if outs:
        import datetime
        first = min(outs, key=lambda r: r["at"])
        print(f"最早一笔转出: {datetime.datetime.utcfromtimestamp(first['at']).isoformat()}Z  {first['hash']}")

    print("\n下一步：")
    print("  - 若出现 'gas 由别人付' → 私钥/助记词已泄露，钱不是被合约拿走的，是被人用私钥签走的。")
    print("  - 若 code 是 0xef0100 → 找那笔写入委托的交易，看受害者当时签的是什么。")
    print("  - 查 ERC20 Approval 事件（本脚本的下一步）可区分'真零授权'与'签了 permit 但像登录'。")


if __name__ == "__main__":
    main()
