import json, os, sys, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

PROXY = "http://172.17.240.1:16781"
os.environ["HTTPS_PROXY"] = PROXY
opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
opener.addheaders = [("User-Agent", "prediction-arena-cover-bot/1.0")]

TOPICS = {
    "football": "football stadium floodlights night",
    "basketball": "basketball arena interior game",
    "esports": "esports tournament stage arena",
    "f1": "formula one racing car track",
    "capitol": "united states capitol building dome",
    "eu": "european parliament hemicycle chamber",
    "fed": "federal reserve building washington",
    "ai-lab": "data center server racks",
    "ai-neural": "abstract network nodes lines dark",
    "meme": "colorful graffiti mural wall",
    "chain": "city skyline night neon",
    "macro-gold": "gold bars vault",
}

OUT = "/tmp/cov-raw"
os.makedirs(OUT, exist_ok=True)
meta = {}


def search(topic, q):
    url = (
        "https://api.openverse.org/v1/images/?"
        + urllib.parse.urlencode(
            {"q": q, "license": "cc0,pdm", "page_size": 8, "aspect_ratio": "wide", "size": "large", "mature": "false"}
        )
    )
    with opener.open(url, timeout=40) as r:
        data = json.load(r)
    return data.get("results", [])


def grab(topic, idx, item):
    ext = os.path.splitext(urllib.parse.urlparse(item["url"]).path)[1] or ".jpg"
    path = f"{OUT}/{topic}-{idx}{ext}"
    try:
        with opener.open(item["url"], timeout=60) as r, open(path, "wb") as f:
            f.write(r.read())
        return {
            "topic": topic,
            "path": path,
            "w": item.get("width"),
            "h": item.get("height"),
            "title": item.get("title"),
            "creator": item.get("creator"),
            "license": item.get("license"),
            "source": item.get("source"),
            "landing": item.get("foreign_landing_url"),
            "bytes": os.path.getsize(path),
        }
    except Exception as e:
        return {"topic": topic, "path": None, "error": str(e)[:120]}


jobs = []
with ThreadPoolExecutor(max_workers=6) as pool:
    futures = {t: pool.submit(search, t, q) for t, q in TOPICS.items()}
    for t, f in futures.items():
        try:
            results = f.result()
        except Exception as e:
            print("search failed", t, e)
            results = []
        print(f"{t}: {len(results)} results")
        for i, item in enumerate(results[:5]):
            jobs.append((t, i, item))

    got = list(pool.map(lambda j: grab(*j), jobs))

meta = [g for g in got if g.get("path")]
json.dump(meta, open(f"{OUT}/meta.json", "w"), indent=1)
print("downloaded", len(meta), "of", len(jobs))
for m in meta:
    print(f'{m["topic"]:11s} {m["w"]}x{m["h"]} {m["license"]:4s} {str(m["title"])[:60]}')
