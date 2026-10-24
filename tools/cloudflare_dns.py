#!/usr/bin/env python3
"""Cloudflare DNS for predictionarena.online — idempotent, API-token only.

    export CF_API_TOKEN=...          # Zone:DNS:Edit + Zone:Read (Zone:Create needs Account:Read)
    export CF_ACCOUNT_ID=...         # dash.cloudflare.com → any zone → Overview → Account ID
    python3 tools/cloudflare_dns.py [--proxied]

What it does, in order:
  1. Find the zone by name; create it if the account does not have it yet (this is what makes the
     registrar delegation stop answering REFUSED — a delegated name with no zone is a lame
     delegation and resolves nowhere).
  2. Upsert the two hostnames Render needs: apex → the Render origin, www → the Render origin.
     A root CNAME is fine on Cloudflare (it is flattened to A at answer time), which is why the
     apex does not need Render's anycast IPs hardcoded.
  3. Print the zone id, the record ids and what the public resolver sees.

Default is DNS-only (grey cloud): Render terminates TLS for the custom domain itself, so the
certificate a visitor sees is Render's and there is no "Full (strict)" chicken-and-egg. Pass
--proxied once the Render certificate is issued if you want Cloudflare's CDN in front.
"""
import argparse, json, os, sys, time, urllib.error, urllib.request

API = "https://api.cloudflare.com/client/v4"
ZONE = "predictionarena.online"
ORIGIN = os.environ.get("RENDER_ORIGIN", "prediction-arena-81d9.onrender.com")
TOKEN = os.environ.get("CF_API_TOKEN", "").strip()
ACCOUNT = os.environ.get("CF_ACCOUNT_ID", "").strip()


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {TOKEN}",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode())


def ok(resp):
    if not resp.get("success"):
        print("API ERROR:", json.dumps(resp.get("errors"), ensure_ascii=False))
        sys.exit(1)
    return resp["result"]


def find_zone():
    r = call("GET", f"/zones?name={ZONE}")
    zones = ok(r)
    return zones[0] if zones else None


def create_zone():
    if not ACCOUNT:
        sys.exit("zone missing and CF_ACCOUNT_ID is not set — cannot create it")
    r = call("POST", "/zones", {"name": ZONE, "account": {"id": ACCOUNT}, "jump_start": False})
    z = ok(r)
    print("created zone", z["id"], "ns:", z.get("name_servers"))
    return z


def upsert(zone_id, rtype, name, content, proxied):
    q = call("GET", f"/zones/{zone_id}/dns_records?type={rtype}&name={name}")
    existing = ok(q)
    body = {"type": rtype, "name": name, "content": content, "ttl": 1, "proxied": proxied,
            "comment": "managed by tools/cloudflare_dns.py"}
    if existing:
        rec = existing[0]
        r = call("PATCH", f"/zones/{zone_id}/dns_records/{rec['id']}", body)
        rec2 = ok(r)
        print(f"updated {rtype} {name} → {content} (proxied={proxied})")
        return rec2
    r = call("POST", f"/zones/{zone_id}/dns_records", body)
    rec2 = ok(r)
    print(f"created {rtype} {name} → {content} (proxied={proxied})")
    return rec2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--proxied", action="store_true", help="orange-cloud the records")
    args = ap.parse_args()

    if not TOKEN:
        sys.exit("CF_API_TOKEN is not set")

    zone = find_zone() or create_zone()
    zid = zone["id"]
    print("zone", ZONE, zid, "status:", zone.get("status"), "ns:", zone.get("name_servers"))

    recs = [upsert(zid, "CNAME", ZONE, ORIGIN, args.proxied),
            upsert(zid, "CNAME", f"www.{ZONE}", ORIGIN, args.proxied)]

    # CNAME flattening on the apex: confirm what Cloudflare actually answers with.
    time.sleep(2)
    for rec in recs:
        print("record", rec["name"], rec["type"], rec["content"], "proxied=", rec["proxied"])

    print(json.dumps({"zone_id": zid, "records": [{"id": r["id"], "name": r["name"]} for r in recs]}))


if __name__ == "__main__":
    main()
