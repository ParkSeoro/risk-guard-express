"""'그때 샀더라면' 계산. 수수료·세금 제외 단순 계산(참고용)."""
from datetime import date


def won(n):
    """한국식 금액 표기: 1억 2,345만원."""
    n = int(round(n))
    sign = "-" if n < 0 else ""
    n = abs(n)
    eok, man = divmod(n // 10000, 10000)
    if eok and man:
        return f"{sign}{eok:,}억 {man:,}만원"
    if eok:
        return f"{sign}{eok:,}억원"
    if man:
        return f"{sign}{man:,}만원"
    return f"{sign}{n:,}원"


def price_on(prices, d):
    """그 날짜 종가. 상장 전이면 None, 거래 없는 날이면 직전 거래일 종가."""
    key = d.isoformat() if isinstance(d, date) else d
    if key in prices:
        return prices[key]
    earlier = [k for k in prices if k <= key]
    return prices[max(earlier)] if earlier else None


def lump(prices, d, amount, now_price):
    p = price_on(prices, d)
    if p is None:
        return None
    value = amount / p * now_price
    return {"then": p, "value": value, "mult": value / amount, "pct": (value / amount - 1) * 100}


def years_ago(today, n):
    try:
        return today.replace(year=today.year - n)
    except ValueError:  # 2월 29일
        return today.replace(year=today.year - n, day=28)
