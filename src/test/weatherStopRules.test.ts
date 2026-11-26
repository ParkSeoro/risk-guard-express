import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WEATHER_STOP_RULES,
  evaluateWeatherAgainstRules,
  normalizeWeatherStopRules,
} from '@/lib/weatherStopRules';

describe('weatherStopRules', () => {
  it('falls back to statutory defaults when project rules are null or partial', () => {
    expect(normalizeWeatherStopRules(null)).toEqual(DEFAULT_WEATHER_STOP_RULES);
    expect(normalizeWeatherStopRules({ craneWindMs: 8 }).craneWindMs).toBe(8);
    expect(normalizeWeatherStopRules({ craneWindMs: 8 }).heatStopC).toBe(35);
  });

  it('triggers stop alert when wind exceeds project-specific crane threshold', () => {
    const res = evaluateWeatherAgainstRules(
      { tempC: 20, windMs: 8.5, rainMmPerHour: 0 },
      { craneWindMs: 8, highWorkWindMs: 10 },
    );
    expect(res.level).toBe('stop');
    expect(res.alerts.some((a) => a.code === 'wind_crane')).toBe(true);
    expect(res.alerts.some((a) => a.code === 'wind_high')).toBe(false);
  });

  it('distinguishes heatwave caution vs stop and coldwave stop', () => {
    const caution = evaluateWeatherAgainstRules({ tempC: 33.5, windMs: 2 });
    expect(caution.level).toBe('caution');
    expect(caution.alerts[0]?.code).toBe('heat');

    const stop = evaluateWeatherAgainstRules({ tempC: 36, windMs: 2 });
    expect(stop.level).toBe('stop');
    expect(stop.alerts[0]?.code).toBe('heat');

    const cold = evaluateWeatherAgainstRules({ tempC: -16, windMs: 2 });
    expect(cold.level).toBe('stop');
    expect(cold.alerts[0]?.code).toBe('cold');

    const normal = evaluateWeatherAgainstRules({ tempC: 22, windMs: 3, rainMmPerHour: 0 });
    expect(normal.level).toBe('normal');
    expect(normal.alerts).toHaveLength(0);
  });
});
