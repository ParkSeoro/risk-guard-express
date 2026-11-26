/**
 * Project-specific Weather Stop-Work Thresholds (SSOT).
 *
 * Defaults follow Korean Occupational Safety & Health Standards (산업안전보건기준에 관한 규칙):
 * - Crane / heavy lifting wind stop: 10 m/s (제383조 / KOSHA C-69)
 * - High-altitude / scaffold wind stop: 10 m/s
 * - Rainfall stop: 10 mm/h
 * - Heatwave caution / stop: 33°C / 35°C (제566조)
 * - Coldwave caution / stop: -12°C / -15°C
 */

export interface WeatherStopRules {
  craneWindMs: number;
  highWorkWindMs: number;
  rainMmPerHour: number;
  heatCautionC: number;
  heatStopC: number;
  coldCautionC: number;
  coldStopC: number;
}

export const DEFAULT_WEATHER_STOP_RULES: WeatherStopRules = {
  craneWindMs: 10,
  highWorkWindMs: 10,
  rainMmPerHour: 10,
  heatCautionC: 33,
  heatStopC: 35,
  coldCautionC: -12,
  coldStopC: -15,
};

function finiteOr(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeWeatherStopRules(raw: unknown): WeatherStopRules {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WEATHER_STOP_RULES };
  const o = raw as Record<string, unknown>;
  return {
    craneWindMs: Math.max(1, finiteOr(o.craneWindMs, DEFAULT_WEATHER_STOP_RULES.craneWindMs)),
    highWorkWindMs: Math.max(1, finiteOr(o.highWorkWindMs, DEFAULT_WEATHER_STOP_RULES.highWorkWindMs)),
    rainMmPerHour: Math.max(1, finiteOr(o.rainMmPerHour, DEFAULT_WEATHER_STOP_RULES.rainMmPerHour)),
    heatCautionC: finiteOr(o.heatCautionC, DEFAULT_WEATHER_STOP_RULES.heatCautionC),
    heatStopC: finiteOr(o.heatStopC, DEFAULT_WEATHER_STOP_RULES.heatStopC),
    coldCautionC: finiteOr(o.coldCautionC, DEFAULT_WEATHER_STOP_RULES.coldCautionC),
    coldStopC: finiteOr(o.coldStopC, DEFAULT_WEATHER_STOP_RULES.coldStopC),
  };
}

export type WeatherAlertLevel = 'normal' | 'caution' | 'stop';

export interface WeatherRuleAlert {
  level: 'caution' | 'stop';
  code: 'wind_crane' | 'wind_high' | 'rain' | 'heat' | 'cold';
  message: string;
}

export interface WeatherStopEvaluation {
  level: WeatherAlertLevel;
  alerts: WeatherRuleAlert[];
}

export function evaluateWeatherAgainstRules(
  sample: {
    tempC?: number | null;
    feelsLikeC?: number | null;
    windMs?: number | null;
    rainMmPerHour?: number | null;
  },
  rawRules?: unknown,
): WeatherStopEvaluation {
  const rules = normalizeWeatherStopRules(rawRules);
  const alerts: WeatherRuleAlert[] = [];

  const wind = sample.windMs != null && Number.isFinite(Number(sample.windMs))
    ? Number(sample.windMs)
    : null;
  const rain = sample.rainMmPerHour != null && Number.isFinite(Number(sample.rainMmPerHour))
    ? Number(sample.rainMmPerHour)
    : null;
  const heatTemp = sample.feelsLikeC != null && Number.isFinite(Number(sample.feelsLikeC))
    ? Number(sample.feelsLikeC)
    : sample.tempC != null && Number.isFinite(Number(sample.tempC))
      ? Number(sample.tempC)
      : null;
  const airTemp = sample.tempC != null && Number.isFinite(Number(sample.tempC))
    ? Number(sample.tempC)
    : null;

  if (wind != null) {
    if (wind >= rules.craneWindMs) {
      alerts.push({
        level: 'stop',
        code: 'wind_crane',
        message: `양중·크레인 작업중지 기준 초과 (풍속 ${wind.toFixed(1)}m/s ≥ ${rules.craneWindMs}m/s)`,
      });
    }
    if (wind >= rules.highWorkWindMs && rules.highWorkWindMs !== rules.craneWindMs) {
      alerts.push({
        level: 'stop',
        code: 'wind_high',
        message: `고소·비계 작업중지 기준 초과 (풍속 ${wind.toFixed(1)}m/s ≥ ${rules.highWorkWindMs}m/s)`,
      });
    } else if (wind >= rules.highWorkWindMs && wind < rules.craneWindMs) {
      alerts.push({
        level: 'stop',
        code: 'wind_high',
        message: `고소·비계 작업중지 기준 초과 (풍속 ${wind.toFixed(1)}m/s ≥ ${rules.highWorkWindMs}m/s)`,
      });
    }
  }

  if (rain != null && rain >= rules.rainMmPerHour) {
    alerts.push({
      level: 'stop',
      code: 'rain',
      message: `강우 옥외작업 중지 기준 초과 (강수량 ${rain.toFixed(1)}mm/h ≥ ${rules.rainMmPerHour}mm/h)`,
    });
  }

  if (heatTemp != null) {
    if (heatTemp >= rules.heatStopC) {
      alerts.push({
        level: 'stop',
        code: 'heat',
        message: `폭염 옥외작업 중지 기준 초과 (${heatTemp.toFixed(1)}℃ ≥ ${rules.heatStopC}℃)`,
      });
    } else if (heatTemp >= rules.heatCautionC) {
      alerts.push({
        level: 'caution',
        code: 'heat',
        message: `폭염 주의 · 시간당 휴식 부여 (${heatTemp.toFixed(1)}℃ ≥ ${rules.heatCautionC}℃)`,
      });
    }
  }

  if (airTemp != null) {
    if (airTemp <= rules.coldStopC) {
      alerts.push({
        level: 'stop',
        code: 'cold',
        message: `한파 옥외작업 중지 기준 초과 (${airTemp.toFixed(1)}℃ ≤ ${rules.coldStopC}℃)`,
      });
    } else if (airTemp <= rules.coldCautionC) {
      alerts.push({
        level: 'caution',
        code: 'cold',
        message: `한파 주의 · 방한조치 필요 (${airTemp.toFixed(1)}℃ ≤ ${rules.coldCautionC}℃)`,
      });
    }
  }

  const level: WeatherAlertLevel = alerts.some((a) => a.level === 'stop')
    ? 'stop'
    : alerts.some((a) => a.level === 'caution')
      ? 'caution'
      : 'normal';

  return { level, alerts };
}
