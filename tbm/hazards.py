"""기상 → 건설현장 위험요인 판정 규칙.

근거 기준(요약, 최종 판단은 현장 관리감독자):
- 폭염: 고용노동부 「폭염 대비 근로자 건강보호 가이드」 체감온도 31/33/35/38℃ 단계,
  산업안전보건기준에 관한 규칙 — 체감온도 33℃ 이상 시 2시간 이내 20분 이상 휴식.
- 강풍: 산업안전보건기준에 관한 규칙 제37조 — 순간풍속 10m/s 초과 타워크레인 설치·수리·점검·해체 중지,
  20m/s 초과 타워크레인 운전 중지. 제383조 — 풍속 10m/s 이상 철골작업 중지.
- 강우/강설: 제383조 — 강우량 1mm/h 이상, 강설량 1cm/h 이상 철골작업 중지.
"""
from dataclasses import dataclass, field

WORK_HOURS = range(7, 18)  # 07:00~17:59

LEVEL_NAMES = {1: "관심", 2: "주의", 3: "경고", 4: "위험"}


@dataclass
class Hazard:
    code: str
    level: int
    title: str
    detail: str
    actions: list = field(default_factory=list)
    basis: str = ""

    @property
    def level_name(self):
        return LEVEL_NAMES[self.level]


@dataclass
class DaySummary:
    feels_max: float
    temp_min: float
    temp_max: float
    gust_max: float
    rain_max_h: float
    rain_total: float
    snow_max_h: float
    peak_feels_hour: int
    peak_gust_hour: int


def summarize(hourly):
    """hourly: {'time': [...ISO], 'apparent_temperature': [...], ...} 하루치(현지시각)."""
    idx = [i for i, t in enumerate(hourly["time"]) if int(t[11:13]) in WORK_HOURS]
    if not idx:
        idx = list(range(len(hourly["time"])))

    def col(name):
        return [(hourly[name][i] or 0.0) for i in idx]

    feels, temp, gust = col("apparent_temperature"), col("temperature_2m"), col("wind_gusts_10m")
    rain, snow = col("precipitation"), col("snowfall")
    hour_of = lambda arr: int(hourly["time"][idx[arr.index(max(arr))]][11:13])
    return DaySummary(
        feels_max=round(max(feels), 1),
        temp_min=round(min(temp), 1),
        temp_max=round(max(temp), 1),
        gust_max=round(max(gust), 1),
        rain_max_h=round(max(rain), 1),
        rain_total=round(sum(rain), 1),
        snow_max_h=round(max(snow), 1),
        peak_feels_hour=hour_of(feels),
        peak_gust_hour=hour_of(gust),
    )


def assess(s: DaySummary):
    out = []

    # 폭염
    f = s.feels_max
    if f >= 31:
        level = 4 if f >= 38 else 3 if f >= 35 else 2 if f >= 33 else 1
        actions = ["물·그늘·휴식 3대 수칙 공지, 시원한 물 비치 확인", "신규·고령·기저질환 근로자 2인1조, 관리감독자 수시 확인"]
        if f >= 33:
            actions.append("2시간 이내마다 20분 이상 휴식 부여(14~17시 집중)")
        if f >= 35:
            actions.append("14~17시 옥외 중작업 재배치·조정, 온열질환 의심자 즉시 119")
        if f >= 38:
            actions.append("긴급조치 외 옥외작업 중지 검토")
        out.append(Hazard("heat", level, f"폭염 {LEVEL_NAMES[level]}",
                          f"작업시간 최고 체감온도 {f}℃ ({s.peak_feels_hour}시경)", actions,
                          "고용노동부 폭염 가이드 · 산업안전보건기준에 관한 규칙"))

    # 강풍
    g = s.gust_max
    if g >= 8:
        level = 4 if g > 20 else 3 if g > 10 else 1
        actions = ["자재·가설물·현수막 결속 상태 점검", "고소작업 시 안전대 체결 재확인"]
        if g > 10:
            actions += ["타워크레인 설치·수리·점검·해체 작업 중지", "철골 조립·고소작업대 작업 중지 검토"]
        if g > 20:
            actions.append("타워크레인 운전 작업 중지")
        out.append(Hazard("wind", level, f"강풍 {LEVEL_NAMES[level]}",
                          f"최대 순간풍속 {g}m/s ({s.peak_gust_hour}시경)", actions,
                          "산업안전보건기준에 관한 규칙 제37조·제383조"))

    # 강우
    if s.rain_max_h >= 1 or s.rain_total >= 5:
        level = 3 if s.rain_max_h >= 10 else 2 if s.rain_max_h >= 1 else 1
        actions = ["가설전기 누전차단기·분전함 방수 점검", "통로·사다리·발판 미끄럼 주의", "굴착면·흙막이 붕괴 징후 확인"]
        if s.rain_max_h >= 1:
            actions.append("철골작업 중지(강우 1mm/h 이상)")
        out.append(Hazard("rain", level, f"강우 {LEVEL_NAMES[level]}",
                          f"시간당 최대 {s.rain_max_h}mm, 작업시간 누적 {s.rain_total}mm", actions,
                          "산업안전보건기준에 관한 규칙 제383조"))

    # 강설
    if s.snow_max_h > 0:
        level = 3 if s.snow_max_h >= 1 else 1
        actions = ["작업통로 제설·결빙 방지제 살포", "가설구조물 적설 하중 확인"]
        if s.snow_max_h >= 1:
            actions.append("철골작업 중지(강설 1cm/h 이상)")
        out.append(Hazard("snow", level, f"강설 {LEVEL_NAMES[level]}",
                          f"시간당 최대 적설 {s.snow_max_h}cm", actions, "산업안전보건기준에 관한 규칙 제383조"))

    # 한파
    if s.temp_min <= -5:
        level = 3 if s.temp_min <= -12 else 2 if s.temp_min <= -10 else 1
        actions = ["따뜻한 옷·물·쉼터 3대 수칙", "콘크리트 보온양생 중 갈탄·난로 사용 시 일산화탄소 측정 후 출입"]
        out.append(Hazard("cold", level, f"한파 {LEVEL_NAMES[level]}",
                          f"작업시간 최저기온 {s.temp_min}℃", actions, "고용노동부 한랭질환 예방 가이드"))

    out.sort(key=lambda h: -h.level)
    return out


def risk_score(hazards):
    return sum(h.level ** 2 for h in hazards)
