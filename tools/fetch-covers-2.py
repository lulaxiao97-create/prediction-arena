import json, os, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

PROXY = "http://172.17.240.1:16781"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
opener.addheaders = [("User-Agent", "prediction-arena-cover-bot/1.0")]

TOPICS = {
    "esports": "esports gaming tournament arena stage",
    "eu": "european parliament building brussels",
    "football2": "soccer stadium crowd match night",
    "fed": "treasury building washington dc columns",
    "gold": "gold coins bullion macro",
    "ai-neural": "abstract glowing network connections",
}

OUT = "/tmp/cov-raw"
os.makedirs(OUT, exist_ok=True)


def search(topic, q):
    url = "https://api.openverse.org/v1/images/?" + urllib.parse.urlencode(
        {"q": q, "license": "cc0,pdm", "page_size": 6, "size": "large", "mature": "false"}
    )
    with opener.open(url, timeout=40) as r:
        return json.load(r).get("results", [])


def grab(topic, idx, item):
    ext = os.path.splitext(urllib.parse.urlparse(item["url"]).path)[1] or ".jpg"
    path = f"{OUT}/{topic}-{idx}{ext}"
    try:
        with opener.open(item["url"], timeout=60) as r, open(path, "wb") as f:
            f.write(r.read())
        return {**{k: item.get(k) for k in ("title", "creator", "license", "source", "foreign_landing_url")},
                "topic": topic, "path": path, "w": item.get("width"), "h": item.get("height"),
                "bytes": os.path.getsize(path)}
    except Exception as e:
        return {"topic": topic, "path": None, "error": str(e)[:100]}


jobs = []
with ThreadPoolExecutor(max_workers=6) as pool:
    fs = {t: pool.submit(search, t, q) for t, q in TOPICS.items()}
    for t, f in fs.items():
        try:
            res = f.result()
        except Exception as e:
            print("search fail", t, e); res = []
        print(t, len(res))
        for i, it in enumerate(res[:4]):
            jobs.append((t, i, it))
    got = list(pool.map(lambda j: grab(*j), jobs))

meta = [g for g in got if g.get("path")]
json.dump(meta, open(f"{OUT}/meta2.json", "w"), indent=1)
for m in meta:
    print(f'{m["topic"]:11s} {m["w"]}x{m["h"]} {str(m["title"])[:60]}')
