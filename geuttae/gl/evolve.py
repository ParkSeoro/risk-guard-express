"""자가 진화: 제목/공유문구 변형을 톰슨 샘플링(베타 분포)으로 고른다.

- 성과 데이터: GoatCounter API(무료, 쿠키 없음). GOATCOUNTER_SITE, GOATCOUNTER_TOKEN 환경변수가 있을 때만 갱신.
- 공유 링크에 ?v={variant} 가 붙고, 그 링크로 들어온 조회수가 '성공'으로 집계된다.
- 데이터가 없으면 균등 사전분포(1,1)로 탐색을 계속하므로 처음부터 안전하게 동작한다.
"""
import json
import os
import random
import urllib.request
from datetime import date, timedelta

TITLE_VARIANTS = {
    "a": "{coin} {when}에 {amount} 샀다면 지금 {value}",  # 후회
    "b": "그때 {coin} 샀으면 지금 {value}… 당신은 얼마?",  # 호기심·비교
    "c": "{when} {coin} {amount} → 지금 {value} ({mult}배)",  # 숫자 직관
    "d": "남들 {coin}로 {mult}배 벌 때 나는? 내 생일로 계산해보기",  # 질투
}


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def ensure(state):
    arms = state.setdefault("arms", {})
    for k in TITLE_VARIANTS:
        arms.setdefault(k, {"views": 0, "shows": 0})
    state.setdefault("log", [])
    return state


def pick(state, rng=random):
    """조회수/노출 비율이 높은 변형을 더 자주 고르되 탐색은 유지."""
    best, best_s = None, -1.0
    for k, a in state["arms"].items():
        shows = max(a["shows"], a["views"])
        s = rng.betavariate(1 + a["views"], 1 + shows - a["views"])
        if s > best_s:
            best, best_s = k, s
    return best


def fetch_views(site, token, start, end):
    """GoatCounter에서 ?v=변형 별 조회수 집계."""
    url = f"https://{site}.goatcounter.com/api/v0/stats/hits?start={start}&end={end}&limit=100"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    views = {}
    for hit in data.get("hits", []):
        path = hit.get("path", "")
        if "v=" in path:
            v = path.split("v=")[-1][:1]
            views[v] = views.get(v, 0) + int(hit.get("count", 0))
    return views


def update(state, today=None):
    site, token = os.environ.get("GOATCOUNTER_SITE"), os.environ.get("GOATCOUNTER_TOKEN")
    if not (site and token):
        return state, "성과 데이터 미연결(GOATCOUNTER_*) — 탐색 모드 유지"
    today = today or date.today()
    start = (today - timedelta(days=1)).isoformat()
    try:
        views = fetch_views(site, token, start, today.isoformat())
    except Exception as e:  # 네트워크 장애로 배포가 멈추면 안 된다
        return state, f"성과 수집 실패: {e}"
    for k, n in views.items():
        if k in state["arms"]:
            state["arms"][k]["views"] += n
    state["log"] = (state["log"] + [{"date": start, "views": views}])[-120:]
    return state, f"성과 반영: {views}"


def save(path, state):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
