#!/usr/bin/env python3
"""End-to-end verification of https://predictionarena.online — DNS, TLS, redirect, OG cards,
WalletConnect metadata, PWA files.

    python3 tools/verify_domain.py [--proxy http://172.17.240.1:16781]

Why it resolves through DoH instead of the system resolver: the WSL box sits behind a network
that blocks plaintext DNS and answers DoH only through the egress proxy, and during a nameserver
migration the local cache is the last thing to catch up. Every check therefore pins the IP that
the public resolver reports (`curl --resolve`) so the result reflects the authoritative answer,
not a stale local cache.

Exit code is the number of failed checks, so CI and a cron keepalive can both use it.
"""
import argparse, json, os, re, socket, ssl, subprocess, sys, urllib.request

ZONE = "predictionarena.online"
WWW = "www." + ZONE
ORIGIN = "prediction-arena-81d9.onrender.com"
# Cloudflare assigns a *fresh* nameserver pair every time a zone is created (the pair is not
# stable per domain), so asserting a specific pair turns a green setup red after any recreate.
# What actually matters is that the delegation points at Cloudflare and nowhere else.
NS_SUFFIX = ".ns.cloudflare.com"

PROXY = None
FAILS = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail else ""))
    if not ok:
        FAILS.append(name)
    return ok


def doh(name, rtype):
    url = f"https://cloudflare-dns.com/dns-query?name={name}&type={rtype}"
    req = urllib.request.Request(url, headers={"accept": "application/dns-json"})
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"https": PROXY, "http": PROXY} if PROXY else {}))
    with opener.open(req, timeout=25) as r:
        return json.loads(r.read().decode())


def curl(url, ip=None, extra=(), ua=None, timeout=40):
    cmd = ["curl", "-sS", "--max-time", str(timeout), "--noproxy", "*"]
    if ip:
        cmd += ["--resolve", f"{url.split('/')[2].split(':')[0]}:443:{ip}"]
    if ua:
        cmd += ["-A", ua]
    cmd += list(extra) + [url]
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.stdout, p.stderr, p.returncode


def resolve_a(host):
    try:
        d = doh(host, "A")
        ips = [a["data"] for a in d.get("Answer", []) if a["type"] == 1]
        return ips
    except Exception as e:  # noqa: BLE001
        return []


def cert_info(host, ip):
    ctx = ssl.create_default_context()
    with socket.create_connection((ip, 443), timeout=20) as s:
        with ctx.wrap_socket(s, server_hostname=host) as tls:
            cert = tls.getpeercert() or {}
            subject = {k: v for pair in cert.get("subject", ()) for k, v in pair}
            issuer = {k: v for pair in cert.get("issuer", ()) for k, v in pair}
            return {
                "subject": subject,
                "issuer": issuer,
                "san": [v for k, v in cert.get("subjectAltName", ()) if k == "DNS"],
                "not_after": cert.get("notAfter"),
                "tls": tls.version(),
            }


def main():
    global PROXY
    ap = argparse.ArgumentParser()
    ap.add_argument("--proxy", default=os.environ.get("VERIFY_PROXY", ""))
    args = ap.parse_args()
    PROXY = args.proxy or None

    print(f"== DNS ({ZONE})")
    ns = sorted(a["data"].rstrip(".") for a in doh(ZONE, "NS").get("Answer", []) if a["type"] == 2)
    check("nameservers are Cloudflare", len(ns) >= 2 and all(n.endswith(NS_SUFFIX) for n in ns),
          ", ".join(ns) or "none")

    apex_ips = resolve_a(ZONE)
    www_ips = resolve_a(WWW)
    check("apex resolves", bool(apex_ips), ", ".join(apex_ips))
    check("www resolves", bool(www_ips), ", ".join(www_ips))
    if not apex_ips:
        print("\nDNS not live yet — remaining checks would only measure the failure.")
        print(f"FAILED {len(FAILS)}")
        return len(FAILS)

    ip = apex_ips[0]

    print("\n== TLS")
    try:
        ci = cert_info(ZONE, ip)
        san_ok = ZONE in ci["san"] or f"*.{ZONE}" in ci["san"]
        check("certificate covers the apex", san_ok, ",".join(ci["san"][:4]))
        check("certificate chains to a public CA", bool(ci["issuer"].get("organizationName")),
              f"{ci['issuer'].get('organizationName')} / {ci['issuer'].get('commonName')}")
        print(f"      subject={ci['subject'].get('commonName')} expires={ci['not_after']} {ci['tls']}")
    except Exception as e:  # noqa: BLE001
        check("TLS handshake", False, str(e))

    print("\n== HTTP")
    out, err, rc = curl(f"https://{ZONE}/", ip, ["-o", "/dev/null", "-w", "%{http_code} %{redirect_url}"])
    code = out.split()[0] if out else "?"
    check("apex returns 200", code == "200", code + " " + err.strip()[:80])

    out, _, _ = curl(f"https://{WWW}/", www_ips[0] if www_ips else None,
                     ["-o", "/dev/null", "-w", "%{http_code} %{redirect_url}"])
    parts = out.split()
    check("www redirects to the apex", len(parts) > 1 and parts[1].startswith(f"https://{ZONE}"),
          out.strip())

    print("\n== Head / metadata")
    head, _, _ = curl(f"https://{ZONE}/", ip, ["-A", "Twitterbot/1.0"])
    for prop in ("og:url", "og:image", "twitter:card"):
        m = re.search(rf'<meta[^>]+(?:property|name)="{prop}"[^>]+content="([^"]+)"', head)
        val = m.group(1) if m else ""
        if prop == "twitter:card":
            check("twitter:card is summary_large_image", val == "summary_large_image", val)
        else:
            check(f"{prop} is on the custom domain", val.startswith(f"https://{ZONE}"), val)

    m = re.search(r'<link rel="canonical" href="([^"]+)"', head)
    check("canonical points at the custom domain", bool(m) and m.group(1).startswith(f"https://{ZONE}"),
          m.group(1) if m else "missing")

    print("\n== WalletConnect verification file")
    body, _, rc = curl(f"https://{ZONE}/.well-known/walletconnect.txt", ip, ["-D", "/tmp/wc_headers"])
    hdrs = open("/tmp/wc_headers").read().lower() if os.path.exists("/tmp/wc_headers") else ""
    check("served as text/plain", "content-type: text/plain" in hdrs)
    check("not cacheable", "no-store" in hdrs)
    print(f"      body={body.strip()[:80]!r}")

    print("\n== PWA + assets")
    for path, ctype in (("/manifest.json", "application/json"), ("/sw.js", "javascript"),
                        ("/icon-512.png", "image/png"), ("/og.png", "image")):
        out, err, rc = curl(f"https://{ZONE}{path}", ip,
                            ["-o", "/dev/null", "-w", "%{http_code} %{content_type}"])
        code, ct = (out.split() + ["", ""])[:2]
        check(f"{path} 200", code == "200", f"{code} {ct}")
        if ctype in ("application/json", "javascript", "image"):
            check(f"{path} content-type", ctype in (ct or ""), ct)

    print("\n== Market OG card")
    market, _, _ = curl(f"https://{ZONE}/market/0", ip, ["-A", "Twitterbot/1.0"])
    og = re.search(r'og:image" content="([^"]+)"', market)
    if og:
        card, _, _ = curl(og.group(1), ip, ["-o", "/tmp/card.png", "-w", "%{http_code} %{content_type}"])
        check("market og:image renders", card.startswith("200") and "image/png" in card, card)
    else:
        check("market page exposes og:image", False, "no tag (market id 0 may not exist)")

    print("\n== Bundle carries the production origin")
    html, _, _ = curl(f"https://{ZONE}/", ip)
    chunks = re.findall(r'src="(/_next/static/[^"]+\.js)"', html)
    found = False
    for c in chunks[:12]:
        js, _, _ = curl(f"https://{ZONE}{c}", ip)
        if f"https://{ZONE}" in js:
            found = True
            break
    check("wallet metadata origin is the custom domain", found, f"{len(chunks)} chunks scanned")

    print("\n== Old origin still serving (so old links keep working)")
    out, _, _ = curl(f"https://{ORIGIN}/", None, ["-o", "/dev/null", "-w", "%{http_code}"])
    check("onrender origin reachable", out.strip() == "200", out.strip())

    print(f"\n{'ALL CHECKS PASSED' if not FAILS else 'FAILED ' + str(len(FAILS)) + ': ' + ', '.join(FAILS)}")
    return len(FAILS)


if __name__ == "__main__":
    sys.exit(1 if main() else 0)
