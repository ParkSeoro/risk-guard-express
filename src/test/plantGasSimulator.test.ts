import { describe, expect, it } from 'vitest';
import {
  PRESET_H2_COMPRESSOR,
  PRESET_LCO2_SUPPLY,
  PRESET_LOX_CRYO,
  buildCircuitFromIso,
  runGasPlantSimulation,
} from '@/lib/plantGasSimulator';
import { SAMPLE_ISO_LOX } from '@/lib/plantIsoEngine';

describe('Air Liquide Gas Plant Operational Simulator', () => {
  it('triggers critical thermal trapping overpressure when cryogenic LOX line is double-blocked without PSV', () => {
    const res = runGasPlantSimulation(PRESET_LOX_CRYO, {
      inletPressureBar: 11,
      ambientHeatPct: 80,
      valveStates: { xv1: false, xv2: false, xv3: true },
      psvStates: { psv1: false },
      checkValveStates: {},
    });

    expect(res.overallStatus).toBe('critical');
    expect(res.segments.seg2.status).toBe('critical');
    expect(res.segments.seg2.pressureBar).toBeGreaterThan(PRESET_LOX_CRYO.designPressureBar);
    expect(res.alarms.some((a) => a.code === 'THERMAL_TRAPPING_OVERPRESSURE')).toBe(true);
  });

  it('safely relieves trapped LOX pressure when Thermal PSV is installed', () => {
    const res = runGasPlantSimulation(PRESET_LOX_CRYO, {
      inletPressureBar: 11,
      ambientHeatPct: 80,
      valveStates: { xv1: false, xv2: false, xv3: true },
      psvStates: { psv1: true },
      checkValveStates: {},
    });

    expect(res.overallStatus).toBe('warning');
    expect(res.segments.seg2.status).toBe('relieving');
    expect(res.segments.seg2.psvRelieving).toBe(true);
    expect(res.relievingPsvIds).toContain('psv1');
  });

  it('detects H2 compressor dead-head overpressure and check-valve backflow', () => {
    const deadhead = runGasPlantSimulation(PRESET_H2_COMPRESSOR, {
      inletPressureBar: 40,
      ambientHeatPct: 85,
      valveStates: { xv1: false },
      psvStates: { psv1: false },
      checkValveStates: { cv1: true },
    });
    expect(deadhead.overallStatus).toBe('critical');
    expect(deadhead.alarms.some((a) => a.code === 'DEAD_HEAD_OVERPRESSURE')).toBe(true);

    const backflow = runGasPlantSimulation(PRESET_H2_COMPRESSOR, {
      inletPressureBar: 12,
      ambientHeatPct: 30,
      downstreamBackpressureBar: 38,
      valveStates: { xv1: true },
      psvStates: { psv1: true },
      checkValveStates: { cv1: false },
    });
    expect(backflow.overallStatus).toBe('critical');
    expect(backflow.alarms.some((a) => a.code === 'BACKFLOW_HAZARD')).toBe(true);
  });

  it('detects LCO2 triple-point dry-ice plugging below 5.2 bar', () => {
    const res = runGasPlantSimulation(PRESET_LCO2_SUPPLY, {
      inletPressureBar: 4.5,
      ambientHeatPct: 25,
      valveStates: { xv1: true, xv2: true },
      psvStates: { psv1: true },
      checkValveStates: {},
    });
    expect(res.overallStatus).toBe('critical');
    expect(res.alarms.some((a) => a.code === 'LCO2_DRY_ICE_PLUGGING')).toBe(true);
  });

  it('auto-builds a live simulation circuit from an analyzed ISO and reproduces missing PSV hazard', () => {
    const circuit = buildCircuitFromIso(SAMPLE_ISO_LOX);
    expect(circuit.gas).toBe('LOX');
    expect(circuit.designPressureBar).toBe(SAMPLE_ISO_LOX.title_block.design_pressure_bar);

    const trapped = runGasPlantSimulation(circuit, {
      inletPressureBar: 11.5,
      ambientHeatPct: 80,
      valveStates: { xv1: false, xv2: false },
      psvStates: { psv1: false }, // SAMPLE_ISO_LOX has 0 PSVs
      checkValveStates: {},
    });
    expect(trapped.overallStatus).toBe('critical');
    expect(trapped.alarms.some((a) => a.code === 'THERMAL_TRAPPING_OVERPRESSURE')).toBe(true);
  });
});
