// Tam metin önbelleği: toplam karakter sınırı (bütün tebliğ metinleri ~1,4M karaktere çıkabilir).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextCache } from '../src/modules/source-text/textCache.js';

const HOUR = 3_600_000;

function make(over: Partial<{ ttlMs: number; maxEntries: number; maxTotalChars: number }> = {}) {
  return new TextCache({ ttlMs: 24 * HOUR, maxEntries: 200, maxTotalChars: 1000, ...over });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('TextCache', () => {
  it('returns what was stored', () => {
    const c = make();
    c.set('a', { full_text: 'x' }, 1);
    expect(c.get('a')).toEqual({ full_text: 'x' });
    expect(c.get('yok')).toBeUndefined();
  });

  it('evicts the oldest entries when total chars exceed the cap', () => {
    const c = make({ maxTotalChars: 1000 });
    c.set('a', 'A', 400);
    c.set('b', 'B', 400);
    c.set('c', 'C', 400); // toplam 1200 > 1000 → en eski ('a') atılır
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe('B');
    expect(c.get('c')).toBe('C');
  });

  it('keeps evicting until the new entry fits', () => {
    const c = make({ maxTotalChars: 1000 });
    c.set('a', 'A', 300);
    c.set('b', 'B', 300);
    c.set('c', 'C', 300);
    c.set('d', 'D', 900); // a, b, c hepsi atılmalı
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBeUndefined();
    expect(c.get('d')).toBe('D');
  });

  it('does not store a single entry larger than the cap, and keeps the others', () => {
    const c = make({ maxTotalChars: 1000 });
    c.set('small', 'S', 100);
    c.set('huge', 'H', 1001);
    expect(c.get('huge')).toBeUndefined();
    expect(c.get('small')).toBe('S');
  });

  it('accepts an entry exactly at the cap', () => {
    const c = make({ maxTotalChars: 1000 });
    c.set('edge', 'E', 1000);
    expect(c.get('edge')).toBe('E');
  });

  it('replacing a key does not double count its chars', () => {
    const c = make({ maxTotalChars: 1000 });
    c.set('a', 'A1', 600);
    c.set('a', 'A2', 600); // aynı anahtar: 600, 1200 değil
    c.set('b', 'B', 400); // 600 + 400 = 1000 → sığar
    expect(c.get('a')).toBe('A2');
    expect(c.get('b')).toBe('B');
  });

  it('drops an expired entry on get', () => {
    const c = make({ ttlMs: 24 * HOUR });
    c.set('a', 'A', 10);
    vi.advanceTimersByTime(24 * HOUR - 1);
    expect(c.get('a')).toBe('A');
    vi.advanceTimersByTime(2);
    expect(c.get('a')).toBeUndefined();
  });

  it('expired entries free their chars (no phantom size)', () => {
    const c = make({ maxTotalChars: 1000, ttlMs: HOUR });
    c.set('old', 'O', 900);
    vi.advanceTimersByTime(2 * HOUR);
    c.set('new', 'N', 900); // 'old' süresi dolmuş: yer açılmalı
    expect(c.get('new')).toBe('N');
    expect(c.get('old')).toBeUndefined();
  });

  it('keeps maxEntries', () => {
    const c = make({ maxEntries: 3, maxTotalChars: 1_000_000 });
    for (const k of ['a', 'b', 'c', 'd']) c.set(k, k.toUpperCase(), 1);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe('B');
    expect(c.get('c')).toBe('C');
    expect(c.get('d')).toBe('D');
  });
});
