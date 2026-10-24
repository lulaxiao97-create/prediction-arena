#!/usr/bin/env python3
"""Attach the custom domain to the Render service and read back its verification state.

    export RENDER_API_KEY=...        # dashboard.render.com → Account Settings → API Keys
    python3 tools/render_domains.py [--service-id srv-xxxx]

Render's API is the only non-interactive way to add a custom domain: the deploy hook redeploys
a service, it does not change its domains, and the blueprint only applies on a sync. So this
script (or the dashboard) is required exactly once per hostname.
"""
import json, os, sys, urllib.error, urllib.request

API = "https://api.render.com/v1"
ORIGIN_HOST = os.environ.get("RENDER_ORIGIN", "prediction-arena-81d9.onrender.com")
HOSTS = ["predictionarena.online", "www.predictionarena.online"]
KEY = os.environ.get("RENDER_API_KEY", "").strip()


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {KEY}",
                                          "Accept": "application/json",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        print(f"{method} {path} → HTTP {e.code}: {raw[:400]}")
        return None


def list_services():
    svc = call("GET", "/services?limit=50") or []
    return [(s["service"]["id"], s["service"]["name"], s["service"].get("serviceDetails", {}).get("url"))
            for s in svc]


def main():
    if not KEY:
        sys.exit("RENDER_API_KEY is not set")

    services = list_services()
    for sid, name, url in services:
        print("service", sid, name, url)

    sid = None
    if "--service-id" in sys.argv:
        sid = sys.argv[sys.argv.index("--service-id") + 1]
    else:
        for s in services:
            if (s[2] or "").startswith(f"https://{ORIGIN_HOST}"):
                sid = s[0]
                break
    if not sid:
        sys.exit("could not find the arena service — pass --service-id")

    print("using service", sid)
    existing = call("GET", f"/services/{sid}/custom-domains") or []
    have = {e["customDomain"]["name"]: e["customDomain"] for e in existing}
    for h in HOSTS:
        if h in have:
            print("exists", h, have[h].get("verificationStatus"))
            continue
        res = call("POST", f"/services/{sid}/custom-domains", {"name": h})
        if res:
            cd = res.get("customDomain", res)
            print("added", cd.get("name"), cd.get("verificationStatus"))

    print("\n--- verification state ---")
    for e in call("GET", f"/services/{sid}/custom-domains") or []:
        cd = e["customDomain"]
        print(f"{cd['name']:32} status={cd.get('verificationStatus')} "
              f"cname_target={cd.get('cnameTarget') or ORIGIN_HOST}")


if __name__ == "__main__":
    main()
