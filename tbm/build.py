"""매일 실행: 날씨 수집 → 위험 판정 → 지역별 TBM 페이지 + 아카이브 + PWA 정적 사이트 생성.

사용: python -m tbm.build [--fixture] [--out site]
"""
import argparse
import json
import os
import random
import shutil
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from html import escape

from . import evolve
from .hazards import assess, risk_score, summarize
from .regions import REGIONS
from .topics import topic_for

KST = timezone(timedelta(hours=9))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
STATIC = os.path.join(ROOT, "static")
WEEKDAYS = "월화수목금토일"


# ---------------------------------------------------------------- 데이터 수집
def fetch_weather():
    q = {
        "latitude": ",".join(str(r[2]) for r in REGIONS),
        "longitude": ",".join(str(r[3]) for r in REGIONS),
        "hourly": "temperature_2m,apparent_temperature,precipitation,snowfall,wind_gusts_10m",
        "wind_speed_unit": "ms",
        "timezone": "Asia/Seoul",
        "forecast_days": 1,
    }
    url = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(q)
    with urllib.request.urlopen(url, timeout=60) as r:
        data = json.load(r)
    data = data if isinstance(data, list) else [data]
    return {REGIONS[i][0]: d["hourly"] for i, d in enumerate(data)}


def fixture_weather(day, seed=0):
    rng = random.Random(seed or day.toordinal())
    out = {}
    for rid, *_ in REGIONS:
        base, wind = rng.uniform(-8, 34), rng.uniform(2, 16)
        wet = rng.random() < 0.3
        out[rid] = {
            "time": [f"{day.isoformat()}T{h:02d}:00" for h in range(24)],
            "temperature_2m": [base + 6 * (1 - abs(h - 14) / 14) for h in range(24)],
            "apparent_temperature": [base + 8 * (1 - abs(h - 14) / 14) for h in range(24)],
            "wind_gusts_10m": [wind * (0.6 + 0.4 * rng.random()) for _ in range(24)],
            "precipitation": [rng.uniform(0, 4) if wet else 0 for _ in range(24)],
            "snowfall": [rng.uniform(0, 1.5) if wet and base < 0 else 0 for _ in range(24)],
        }
    return out


# ---------------------------------------------------------------- 콘텐츠 생성
def headline(hazards):
    return " · ".join(h.title for h in hazards[:2]) if hazards else "기상 특이사항 없음"


def tbm_script(region_name, day, s, hazards, topic):
    t_name, t_points = topic
    lines = [
        f"[{day.month}/{day.day}({WEEKDAYS[day.weekday()]}) {region_name} 현장 TBM]",
        "",
        "1. 오늘 기상",
        f"- 기온 {s.temp_min}~{s.temp_max}℃, 최고 체감 {s.feels_max}℃, 최대 순간풍속 {s.gust_max}m/s, 강수 {s.rain_total}mm",
    ]
    if hazards:
        lines += ["", "2. 기상 위험요인과 조치"]
        for h in hazards:
            lines.append(f"■ {h.title}: {h.detail}")
            lines += [f"  - {a}" for a in h.actions]
    else:
        lines += ["", "2. 기상 위험요인: 특이사항 없음 — 기본 안전수칙 준수"]
    lines += ["", f"3. 오늘의 집중 주제: {t_name}"]
    lines += [f"  - {p}" for p in t_points]
    lines += [
        "",
        "4. 공통",
        "  - 안전모 턱끈·안전화·안전대 착용 상태 상호 확인",
        "  - 위험하면 누구든 작업중지 요청 가능(작업중지권)",
        "",
        "구호: 안전 확인, 좋아! 좋아! 좋아!",
    ]
    return "\n".join(lines)


def build_region_record(rid, name, day, hourly):
    s = summarize(hourly)
    hz = assess(s)
    topic = topic_for(day)
    return {
        "id": rid,
        "name": name,
        "date": day.isoformat(),
        "summary": s.__dict__,
        "hazards": [h.__dict__ for h in hz],
        "score": risk_score(hz),
        "headline": headline(hz),
        "script": tbm_script(name, day, s, hz, topic),
    }


# ---------------------------------------------------------------- HTML
def page(cfg, title, desc, body, path, depth=0):
    up = "../" * depth
    canon = cfg["site_url"].rstrip("/") + "/" + path
    ads = ""
    if cfg.get("adsense_client"):
        ads = (f'<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='
               f'{escape(cfg["adsense_client"])}" crossorigin="anonymous"></script>')
    gc = ""
    if cfg.get("goatcounter_site"):
        gc = (f'<script data-goatcounter="https://{escape(cfg["goatcounter_site"])}.goatcounter.com/count" '
              f'async src="https://gc.zgo.at/count.js"></script>')
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)}</title><meta name="description" content="{escape(desc)}">
<link rel="canonical" href="{escape(canon)}">
<meta property="og:title" content="{escape(title)}"><meta property="og:description" content="{escape(desc)}">
<meta name="theme-color" content="#f5a400">
<link rel="manifest" href="{up}manifest.webmanifest"><link rel="icon" href="{up}icon.svg">
<link rel="stylesheet" href="{up}style.css">{ads}</head><body>
<header><a href="{up}index.html" class="logo">⛑ 오늘의 TBM</a></header>
<main>{body}</main>
<footer><p>기상자료: Open-Meteo. 본 자료는 참고용이며 작업중지 등 최종 판단은 현장 관리감독자가 합니다.</p>
<p><a href="{up}archive/index.html">지난 TBM</a></p></footer>
<script src="{up}app.js"></script>{gc}</body></html>"""


def affiliate_box(cfg, hazards):
    links = cfg.get("affiliate", {})
    items = []
    for code in [h["code"] for h in hazards] + ["default"]:
        for it in links.get(code, []):
            if it not in items:
                items.append(it)
    if not items:
        return ""
    lis = "".join(f'<li><a href="{escape(i["url"])}" rel="sponsored nofollow" target="_blank">{escape(i["name"])}</a></li>'
                  for i in items[:4])
    return (f'<section class="aff"><h3>오늘 필요한 안전용품</h3><ul>{lis}</ul>'
            f'<p class="disc">{escape(cfg.get("affiliate_disclosure", ""))}</p></section>')


def ad_slot(cfg):
    if not (cfg.get("adsense_client") and cfg.get("adsense_slot")):
        return ""
    return (f'<ins class="adsbygoogle" style="display:block" data-ad-client="{escape(cfg["adsense_client"])}" '
            f'data-ad-slot="{escape(cfg["adsense_slot"])}" data-ad-format="auto" data-full-width-responsive="true"></ins>'
            '<script>(adsbygoogle=window.adsbygoogle||[]).push({});</script>')


def region_body(cfg, rec, variant, archived=False):
    hz_html = "".join(
        f'<div class="hz l{h["level"]}"><b>{escape(h["title"])}</b> <span>{escape(h["detail"])}</span>'
        f'<ul>{"".join(f"<li>{escape(a)}</li>" for a in h["actions"])}</ul><small>{escape(h["basis"])}</small></div>'
        for h in rec["hazards"]) or '<div class="hz l0"><b>기상 특이사항 없음</b></div>'
    sign_rows = "".join(f"<tr><td>{i}</td><td></td><td></td><td></td></tr>" for i in range(1, 16))
    note = '<p class="old">지난 자료입니다. <a href="../../r/{0}.html">오늘 TBM 보기</a></p>'.format(rec["id"]) if archived else ""
    return f"""{note}<h1>{escape(rec["name"])} · {rec["date"]}</h1>
<p class="head">{escape(rec["headline"])}</p>
<div class="btns"><button data-act="copy">📋 복사</button><button data-act="share" data-v="{variant}">📤 단톡방 공유</button>
<button data-act="print">🖨 서명부 인쇄</button></div>
{hz_html}
<pre id="script">{escape(rec["script"])}</pre>
{ad_slot(cfg)}{affiliate_box(cfg, rec["hazards"])}
<section class="sign"><h3>TBM 참석자 서명부 — {escape(rec["name"])} {rec["date"]}</h3>
<p>공종/작업: ____________ 진행자: ____________</p>
<table><tr><th>No</th><th>소속</th><th>성명</th><th>서명</th></tr>{sign_rows}</table></section>"""


def render(cfg, records, history_days, state, out, today):
    if os.path.exists(out):
        shutil.rmtree(out)
    shutil.copytree(STATIC, out)
    urls = []
    rng = random.Random(today.toordinal())

    # 지역별 오늘 페이지(변형은 진화 상태로 선택)
    os.makedirs(os.path.join(out, "r"))
    date_str = f"{today.month}/{today.day}"
    for rec in records:
        v = evolve.pick(state, rng)
        state["arms"][v]["shows"] += 1
        title = evolve.TITLE_VARIANTS[v].format(date=date_str, region=rec["name"], headline=rec["headline"])
        html = page(cfg, title, rec["script"][:150], region_body(cfg, rec, v), f"r/{rec['id']}.html", 1)
        with open(os.path.join(out, "r", f"{rec['id']}.html"), "w", encoding="utf-8") as f:
            f.write(html)
        urls.append(f"r/{rec['id']}.html")

    # 아카이브(롱테일 검색 유입이 매일 누적되는 자산)
    arch_links = []
    for day_str, recs in history_days:
        d = os.path.join(out, "archive", day_str)
        os.makedirs(d, exist_ok=True)
        for rec in recs:
            title = f"{rec['date']} {rec['name']} 건설현장 TBM — {rec['headline']}"
            with open(os.path.join(d, f"{rec['id']}.html"), "w", encoding="utf-8") as f:
                f.write(page(cfg, title, rec["script"][:150], region_body(cfg, rec, "a", True),
                             f"archive/{day_str}/{rec['id']}.html", 2))
            urls.append(f"archive/{day_str}/{rec['id']}.html")
        arch_links.append(f'<li>{day_str}: ' + " ".join(
            f'<a href="{day_str}/{r["id"]}.html">{escape(r["name"])}</a>' for r in recs) + "</li>")
    os.makedirs(os.path.join(out, "archive"), exist_ok=True)
    with open(os.path.join(out, "archive", "index.html"), "w", encoding="utf-8") as f:
        f.write(page(cfg, "지난 건설현장 TBM 모음", "날짜·지역별 TBM 자료",
                     "<h1>지난 TBM</h1><ul class='arch'>" + "".join(reversed(arch_links)) + "</ul>",
                     "archive/index.html", 1))

    # 메인: 전국 위험 순위
    ranked = sorted(records, key=lambda r: -r["score"])
    rows = "".join(
        f'<a class="card s{min(r["score"] // 4, 4)}" href="r/{r["id"]}.html"><b>{escape(r["name"])}</b>'
        f'<span>{escape(r["headline"])}</span></a>' for r in ranked)
    body = (f'<h1>{today.month}월 {today.day}일({WEEKDAYS[today.weekday()]}) 전국 현장 TBM</h1>'
            '<p class="head">매일 새벽 기상예보로 자동 작성되는 작업 전 안전교육 자료. 내 지역을 누르면 복사·공유·서명부 인쇄까지 한 번에.</p>'
            '<button id="install" hidden>📲 홈 화면에 앱 설치</button>'
            f'<div class="grid">{rows}</div>{ad_slot(cfg)}')
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write(page(cfg, f"{today.month}/{today.day} 오늘의 건설현장 TBM · 전국 기상 위험 자동 안전교육",
                     "건설현장 TBM(작업 전 안전점검회의) 자료를 매일 기상예보로 자동 생성. 폭염·강풍·강우·한파 작업중지 기준 포함.",
                     body, "", 0))
    urls.insert(0, "")

    base = cfg["site_url"].rstrip("/") + "/"
    with open(os.path.join(out, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                + "".join(f"<url><loc>{escape(base + u)}</loc></url>" for u in urls) + "</urlset>")
    with open(os.path.join(out, "robots.txt"), "w") as f:
        f.write(f"User-agent: *\nAllow: /\nSitemap: {base}sitemap.xml\n")
    with open(os.path.join(out, ".nojekyll"), "w") as f:
        f.write("")
    return len(urls)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", action="store_true", help="네트워크 없이 가짜 기상으로 빌드(테스트용)")
    ap.add_argument("--out", default=os.path.join(ROOT, "site"))
    args = ap.parse_args()

    cfg = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
    env_url = os.environ.get("SITE_URL")
    if env_url:
        cfg["site_url"] = env_url
    if os.environ.get("GOATCOUNTER_SITE"):
        cfg["goatcounter_site"] = os.environ["GOATCOUNTER_SITE"]

    today = datetime.now(KST).date()
    weather = fixture_weather(today) if args.fixture else fetch_weather()
    records = [build_region_record(rid, name, today, weather[rid]) for rid, name, *_ in REGIONS]

    state_path = os.path.join(DATA, "evolution.json")
    state = evolve.ensure(evolve.load(state_path))
    state, msg = evolve.update(state, today)
    print(msg)

    hist_dir = os.path.join(DATA, "history")
    os.makedirs(hist_dir, exist_ok=True)
    if not args.fixture:
        with open(os.path.join(hist_dir, f"{today.isoformat()}.json"), "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False)
    history = []
    for fn in sorted(os.listdir(hist_dir)):
        if fn.endswith(".json"):
            history.append((fn[:-5], json.load(open(os.path.join(hist_dir, fn), encoding="utf-8"))))
    if args.fixture:
        history.append((today.isoformat(), records))

    n = render(cfg, records, history, state, args.out, today)
    if not args.fixture:
        evolve.save(state_path, state)
    print(f"{today} 빌드 완료: {len(records)}개 지역, 총 {n}페이지 → {args.out}")


if __name__ == "__main__":
    main()
