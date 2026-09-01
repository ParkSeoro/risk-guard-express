import { describe, expect, it } from 'vitest';
import {
  classifyNvidiaHttpError,
  isFailoverHttp,
  isRetiredModelText,
} from '../../supabase/functions/_shared/nvidiaHttp';

describe('nvidiaHttp failover', () => {
  it('treats 410 Gone as failover + MODEL_NOT_FOUND', () => {
    const body = 'The model has reached its end of life on 2026-08-26T09:00:00Z';
    expect(isRetiredModelText(body)).toBe(true);
    expect(isFailoverHttp(410, body)).toBe(true);
    const classified = classifyNvidiaHttpError(
      410,
      body,
      'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    );
    expect(classified.code).toBe('MODEL_NOT_FOUND');
    expect(classified.status).toBe(410);
    expect(classified.message).toContain('410');
    expect(classified.message).toContain('nvidia/llama-3.3-nemotron-super-49b-v1.5');
  });

  it('still failovers 429 / 503 / 404 / missing-model 400', () => {
    expect(isFailoverHttp(429, '')).toBe(true);
    expect(isFailoverHttp(503, '')).toBe(true);
    expect(isFailoverHttp(404, '')).toBe(true);
    expect(isFailoverHttp(400, 'model does not exist')).toBe(true);
  });

  it('does not failover ordinary 400 / 401', () => {
    expect(isFailoverHttp(400, 'invalid json schema')).toBe(false);
    expect(isFailoverHttp(401, 'invalid api key')).toBe(false);
    const classified = classifyNvidiaHttpError(500, 'boom', 'x');
    expect(classified.code).toBe('SERVER_ERROR');
    expect(classified.message).toBe('NVIDIA AI 서버 오류 (500)');
  });
});
