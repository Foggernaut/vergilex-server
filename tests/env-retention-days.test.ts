// An empty Railway variable must not silently turn retention off: '' → default 30,
// not coerce('') → 0. An explicit 0 still disables it.
import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'RETENTION_DELETED_CONVERSATION_DAYS';

async function load(value: string | undefined): Promise<number> {
  vi.resetModules();
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  const { env } = await import('../src/config/env.js');
  return env.RETENTION_DELETED_CONVERSATION_DAYS;
}

afterEach(() => {
  delete process.env[KEY];
  vi.resetModules();
});

describe('RETENTION_DELETED_CONVERSATION_DAYS', () => {
  it('empty string falls back to the default (30)', async () => {
    expect(await load('')).toBe(30);
  });
  it('unset → 30', async () => {
    expect(await load(undefined)).toBe(30);
  });
  it('explicit 0 disables retention', async () => {
    expect(await load('0')).toBe(0);
  });
  it('explicit value is honoured', async () => {
    expect(await load('45')).toBe(45);
  });
});
