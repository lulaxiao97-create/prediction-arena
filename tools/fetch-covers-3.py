import json, os, urllib.parse, urllib.request

PROXY = "http://172.17.240.1:16781"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
opener.addheaders = [("User-Agent", "prediction-arena-cover-bot/1.0 (contact: site@predictionarena.online)")]

QUERIES = {
    "esports": "esports tournament arena stage",
    "football2": "football stadium floodlights crowd",
    "eu2": "European Parliament hemicycle Strasbourg",
    "gold2": "gold bullion bars",
}
OUT = "/tmp/cov-raw"
meta = []

for topic, q in QUERIES.items():
    params = {
        "action": "query", "generator": "search", "gsrsearch": f"filetype:bitmap {q}", "gsrnamespace": 6,
        "gsrlimit": 6, "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": 1600, "format": "json",
    }
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    try:
        with opener.open(url, timeout=45) as r:
            data = json.load(r)
    except Exception as e:
        print("fail", topic, e); continue
    pages = (data.get("query") or {}).get("pages") or {}
    print(topic, len(pages))
    for n, p in enumerate(pages.values()):
        ii = (p.get("imageinfo") or [{}])[0]
        src = ii.get("thumburl") or ii.get("url")
        if not src:
            continue
        ext = os.path.splitext(urllib.parse.urlparse(src).path)[1].lower() or ".jpg"
        if ext not in (".jpg", ".jpeg", ".png"):
            continue
        path = f"{OUT}/{topic}-{n}{ext}"
        try:
            with opener.open(src, timeout=60) as r, open(path, "wb") as f:
                f.write(r.read())
        except Exception as e:
            print("  dl fail", e); continue
        em = ii.get("extmetadata") or {}
        meta.append({
            "topic": topic, "path": path, "w": ii.get("width"), "h": ii.get("height"),
            "title": p.get("title"), "license": (em.get("LicenseShortName") or {}).get("value"),
            "artist": (em.get("Artist") or {}).get("value", "")[:80],
            "landing": ii.get("descriptionurl"), "bytes": os.path.getsize(path),
        })
        print(f'  {p.get("title")[:70]} {ii.get("width")}x{ii.get("height")} {(em.get("LicenseShortName") or {}).get("value")}')

json.dump(meta, open(f"{OUT}/meta3.json", "w"), indent=1)
