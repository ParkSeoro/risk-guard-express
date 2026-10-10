"""매일 실행: 업비트 시세 갱신 → '그때 샀더라면' 계산 페이지·계산기·아카이브 정적 사이트 생성.

사용: python -m gl.build [--offline] [--out site]
  --offline : 네트워크 없이 data/prices 에 저장된 시세만으로 빌드
"""
import argparse
import json
import os
import random
import shutil
from datetime import date, datetime, timedelta, timezone
from html import escape

from . import evolve, fetch
from .calc import lump, price_on, won, years_ago
from .markets import MARKETS

KST = timezone(timedelta(hours=9))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
STATIC = os.path.join(ROOT, "static")
AMOUNT = 1_000_000
DISCLAIMER = ("투자 권유가 아닌 과거 시세 기반 단순 계산입니다. 수수료·세금은 반영하지 않았습니다. "
              "가상자산은 가격 변동이 매우 커 원금 손실 위험이 있습니다.")


# ---------------------------------------------------------------- HTML 뼈대
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
<meta property="og:locale" content="ko_KR"><meta name="theme-color" content="#3b2bd9">
<link rel="manifest" href="{up}manifest.webmanifest"><link rel="icon" href="{up}icon.svg">
<link rel="stylesheet" href="{up}style.css">{ads}</head><body data-root="{up}">
<header><a href="{up}index.html" class="logo">그때살걸</a></header>
<main>{body}</main>
<footer><p>{DISCLAIMER}</p><p>시세: 업비트 원화마켓 일봉 종가(한국시간 기준).</p>
<p><a href="{up}index.html">계산기</a> · {" · ".join(f'<a href="{up}c/{s}.html">{escape(n)}</a>' for _, n, s in MARKETS)}</p></footer>
<script src="{up}app.js"></script>{gc}</body></html>"""


def ad_slot(cfg):
    if not (cfg.get("adsense_client") and cfg.get("adsense_slot")):
        return ""
    return (f'<ins class="adsbygoogle" style="display:block" data-ad-client="{escape(cfg["adsense_client"])}" '
            f'data-ad-slot="{escape(cfg["adsense_slot"])}" data-ad-format="auto" data-full-width-responsive="true"></ins>'
            '<script>(adsbygoogle=window.adsbygoogle||[]).push({});</script>')


def fmt_mult(m):
    return f"{m:,.1f}" if m < 100 else f"{m:,.0f}"


def cls(r):
    return "up" if r["mult"] >= 1 else "down"


# ---------------------------------------------------------------- 페이지
def regret_rows(prices_all, today):
    """종목별 1·3·5년 전 오늘 100만원 → 지금."""
    rows = []
    for _, name, slug in MARKETS:
        prices = prices_all.get(slug)
        if not prices:
            continue
        now = prices[max(prices)]
        cells = []
        for n in (1, 3, 5):
            r = lump(prices, years_ago(today, n), AMOUNT, now)
            cells.append(r)
        rows.append((name, slug, cells))
    return rows


def best_story(prices_all, today):
    """메인 제목에 쓸 가장 극적인 사례(5년 전 오늘 기준 최대 배수)."""
    best = None
    for _, name, slug in MARKETS:
        prices = prices_all.get(slug)
        if not prices:
            continue
        r = lump(prices, years_ago(today, 5), AMOUNT, prices[max(prices)])
        if r and (best is None or r["mult"] > best[2]["mult"]):
            best = (name, slug, r)
    return best


def index_page(cfg, prices_all, today, state, rng):
    v = evolve.pick(state, rng)
    state["arms"][v]["shows"] += 1
    best = best_story(prices_all, today)
    if best:
        name, slug, r = best
        title = evolve.TITLE_VARIANTS[v].format(coin=name, when="5년 전 오늘", amount="100만원",
                                                value=won(r["value"]), mult=fmt_mult(r["mult"]))
    else:
        title, slug = "그때살걸 — 그때 샀다면 지금 얼마?", MARKETS[0][2]

    def td(r):
        if r is None:
            return '<td class="na">상장 전</td>'
        return f'<td class="{cls(r)}">{won(r["value"])}<small>{fmt_mult(r["mult"])}배</small></td>'

    table = "".join(f'<tr><th><a href="c/{s}.html">{escape(n)}</a></th>{"".join(td(c) for c in cells)}</tr>'
                    for n, s, cells in regret_rows(prices_all, today))
    opts = "".join(f'<option value="{s}"{" selected" if s == slug else ""}>{escape(n)}</option>' for _, n, s in MARKETS)
    body = f"""<h1>{escape(title)}</h1>
<p class="sub">날짜만 넣으면 그날 샀을 때 지금 얼마인지 바로 계산합니다. 생일·입사일·결혼기념일로 해보세요.</p>
<section class="calc" id="calc" data-v="{v}">
 <div class="tabs"><button class="on" data-mode="once">그날 한 번</button><button data-mode="bday">매년 생일마다</button></div>
 <label>종목 <select id="coin">{opts}</select></label>
 <label class="once">날짜 <input type="date" id="date" min="2017-09-25" max="{today.isoformat()}" value="{years_ago(today, 5).isoformat()}"></label>
 <label class="bday" hidden>생일(월·일) <input type="text" id="md" inputmode="numeric" placeholder="예: 0315" maxlength="4"></label>
 <label>금액(원) <input type="text" id="amt" inputmode="numeric" value="1,000,000"></label>
 <button id="go" class="big">계산하기</button>
 <div id="out" aria-live="polite"></div>
 <div class="btns" id="sharebox" hidden><button data-act="share">📤 카톡으로 자랑/후회 공유</button><button data-act="copy">📋 결과 복사</button></div>
 <button id="install" hidden>📲 홈 화면에 앱 설치</button>
</section>
{ad_slot(cfg)}
<h2>{today.month}월 {today.day}일 오늘의 후회 랭킹 <small>100만원 기준</small></h2>
<div class="tw"><table class="rank"><tr><th>종목</th><th>1년 전 오늘</th><th>3년 전 오늘</th><th>5년 전 오늘</th></tr>{table}</table></div>"""
    desc = "비트코인·이더리움·리플 등 그때 샀다면 지금 얼마? 날짜·생일로 계산하는 가상자산 후회 계산기. 업비트 원화 시세 기준."
    return page(cfg, title, desc, body, "", 0), [""]


def coin_page(cfg, name, slug, prices, today, state, rng):
    v = evolve.pick(state, rng)
    state["arms"][v]["shows"] += 1
    now = prices[max(prices)]
    first = min(prices)
    r5 = lump(prices, max(years_ago(today, 5), date.fromisoformat(first)), AMOUNT, now)
    when = "5년 전 오늘" if years_ago(today, 5).isoformat() >= first else f"상장일({first})"
    title = evolve.TITLE_VARIANTS[v].format(coin=name, when=when, amount="100만원",
                                            value=won(r5["value"]), mult=fmt_mult(r5["mult"]))
    rows = []
    for y in range(today.year - 1, int(first[:4]) - 1, -1):
        d = today.replace(year=y) if not (today.month == 2 and today.day == 29) else date(y, 2, 28)
        r = lump(prices, d, AMOUNT, now)
        if r:
            rows.append(f'<tr><td>{y}년 {today.month}월 {today.day}일</td><td>{won(r["then"])}</td>'
                        f'<td class="{cls(r)}">{won(r["value"])}</td><td class="{cls(r)}">{fmt_mult(r["mult"])}배</td></tr>')
    months = sorted({k[:7] for k in prices}, reverse=True)
    by_year = {}
    for m in months:
        by_year.setdefault(m[:4], []).append(m)
    mlinks = "".join(f'<p><b>{y}년</b> ' + " ".join(f'<a href="{slug}/{m}.html">{int(m[5:])}월</a>' for m in reversed(ms)) + "</p>"
                     for y, ms in by_year.items())
    body = f"""<h1>{escape(title)}</h1>
<p class="sub">현재가 {won(now)} · 업비트 상장 이후 매년 오늘 100만원씩 샀다면?</p>
<p><a class="big btnlink" href="../index.html">📅 내 날짜로 계산하기</a></p>
<div class="tw"><table><tr><th>매수일</th><th>그날 가격</th><th>100만원 → 지금</th><th>배수</th></tr>{"".join(rows)}</table></div>
{ad_slot(cfg)}<h2>월별 날짜별 계산</h2>{mlinks}"""
    desc = f"{name}을 그때 샀다면 지금 얼마? 연도별·날짜별 100만원 투자 결과를 업비트 원화 시세로 매일 갱신합니다."
    return page(cfg, title, desc, body, f"c/{slug}.html", 1)


def month_page(cfg, name, slug, prices, month, now):
    days = sorted(k for k in prices if k.startswith(month))
    rows = "".join(
        f'<tr><td>{d[5:7]}/{d[8:]}</td><td>{won(prices[d])}</td>'
        f'<td class="{cls(r)}">{won(r["value"])}</td><td class="{cls(r)}">{fmt_mult(r["mult"])}배</td></tr>'
        for d in days for r in [lump(prices, d, AMOUNT, now)])
    y, m = month[:4], int(month[5:])
    title = f"{y}년 {m}월 {name} 100만원 샀다면 지금 얼마? (날짜별 계산)"
    body = f"""<h1>{escape(title)}</h1><p class="sub">현재가 {won(now)} 기준, 매일 자동 갱신.</p>
<p><a class="big btnlink" href="../../index.html">📅 다른 날짜·금액으로 계산</a></p>
<div class="tw"><table><tr><th>날짜</th><th>그날 가격</th><th>100만원 → 지금</th><th>배수</th></tr>{rows}</table></div>
{ad_slot(cfg)}<p><a href="../{slug}.html">{escape(name)} 전체 기간 보기</a></p>"""
    desc = f"{y}년 {m}월 각 날짜에 {name} 100만원을 샀다면 지금 얼마인지 날짜별로 계산한 표."
    return page(cfg, title, desc, body, f"c/{slug}/{month}.html", 2)


def render(cfg, prices_all, state, out, today):
    if os.path.exists(out):
        shutil.rmtree(out)
    shutil.copytree(STATIC, out)
    rng = random.Random(today.toordinal())
    urls = []

    html, u = index_page(cfg, prices_all, today, state, rng)
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    urls += u

    os.makedirs(os.path.join(out, "prices"))
    for _, name, slug in MARKETS:
        prices = prices_all.get(slug)
        if not prices:
            continue
        with open(os.path.join(out, "prices", f"{slug}.json"), "w", encoding="utf-8") as f:
            json.dump(prices, f, separators=(",", ":"))
        os.makedirs(os.path.join(out, "c", slug), exist_ok=True)
        with open(os.path.join(out, "c", f"{slug}.html"), "w", encoding="utf-8") as f:
            f.write(coin_page(cfg, name, slug, prices, today, state, rng))
        urls.append(f"c/{slug}.html")
        now = prices[max(prices)]
        for month in sorted({k[:7] for k in prices}):
            with open(os.path.join(out, "c", slug, f"{month}.html"), "w", encoding="utf-8") as f:
                f.write(month_page(cfg, name, slug, prices, month, now))
            urls.append(f"c/{slug}/{month}.html")

    base = cfg["site_url"].rstrip("/") + "/"
    with open(os.path.join(out, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                + "".join(f"<url><loc>{escape(base + u)}</loc><lastmod>{today.isoformat()}</lastmod></url>" for u in urls)
                + "</urlset>")
    with open(os.path.join(out, "robots.txt"), "w") as f:
        f.write(f"User-agent: *\nAllow: /\nSitemap: {base}sitemap.xml\n")
    with open(os.path.join(out, ".nojekyll"), "w") as f:
        f.write("")
    return len(urls)


def load_prices(offline):
    out = {}
    for market, name, slug in MARKETS:
        path = os.path.join(DATA, "prices", f"{slug}.json")
        try:
            out[slug] = fetch.update(path, market) if not offline else json.load(open(path, encoding="utf-8"))
        except Exception as e:  # 한 종목 실패로 전체 배포가 멈추지 않게
            print(f"{name} 시세 갱신 실패: {e}")
            if os.path.exists(path):
                out[slug] = json.load(open(path, encoding="utf-8"))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--out", default=os.path.join(ROOT, "site"))
    args = ap.parse_args()

    cfg = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
    if os.environ.get("SITE_URL"):
        cfg["site_url"] = os.environ["SITE_URL"]
    if os.environ.get("GOATCOUNTER_SITE"):
        cfg["goatcounter_site"] = os.environ["GOATCOUNTER_SITE"]

    today = datetime.now(KST).date()
    prices_all = load_prices(args.offline)
    if not prices_all:
        raise SystemExit("시세 데이터가 없습니다.")

    state_path = os.path.join(DATA, "evolution.json")
    state = evolve.ensure(evolve.load(state_path))
    state, msg = evolve.update(state, today)
    print(msg)

    n = render(cfg, prices_all, state, args.out, today)
    evolve.save(state_path, state)
    print(f"{today} 빌드 완료: {len(prices_all)}개 종목, 총 {n}페이지 → {args.out}")


if __name__ == "__main__":
    main()
