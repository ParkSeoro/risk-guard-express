"""업비트 공개 API(키 불필요)로 일봉 종가를 받아 data/prices/{slug}.json 에 누적 저장.

날짜는 업비트 일봉 기준(한국시간 09:00 시작)인 candle_date_time_kst 의 날짜를 쓴다.
처음 한 번은 전체 이력을, 이후에는 최근 200일만 받아 덮어쓴다.
"""
import json
import os
import time
import urllib.parse
import urllib.request

API = "https://api.upbit.com/v1/candles/days"


def _get(market, to=None):
    q = {"market": market, "count": 200}
    if to:
        q["to"] = to
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(q), headers={"accept": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def fetch_market(market, full):
    """{날짜: 종가} — full=False면 최근 200일만."""
    out, to = {}, None
    while True:
        rows = _get(market, to)
        for r in rows:
            out[r["candle_date_time_kst"][:10]] = r["trade_price"]
        if not full or len(rows) < 200:
            return out
        to = rows[-1]["candle_date_time_utc"] + "Z"
        time.sleep(0.2)  # 업비트 요청 제한(초당 10회) 준수


def update(path, market):
    try:
        with open(path, encoding="utf-8") as f:
            prices = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        prices = {}
    prices.update(fetch_market(market, full=not prices))
    prices = dict(sorted(prices.items()))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(prices, f, separators=(",", ":"))
    return prices
