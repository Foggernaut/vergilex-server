import { describe, it, expect, vi } from 'vitest';
import { CATEGORIES, type CategoryCount } from '../src/modules/catalog/catalog.types.js';
import {
  parseTazelikKeys,
  tazelikEkle,
  tazelikOku,
  type KorpusTazelikRow,
} from '../src/modules/catalog/tazelik.js';

// Veri tazeliği (db migration 066 `korpus_tazelik`): Sistemdeki Belgeler kategori yanıtına isteğe bağlı
// `tazelik`. SISTEM_BELGELER_TAZELIK boşken yanıt bugünküyle birebir aynı; yalnız danistay/ozelgeler açılabilir.

const CATS: CategoryCount[] = CATEGORIES.map((c) => ({ key: c.key, label: c.label, total: 10 }));

const rowDanistay: KorpusTazelikRow = {
  korpus: 'danistay',
  son_guncelleme: '2026-09-21T00:00:00+00:00',
  en_yeni_belge: '2026-06-10',
  son_30_gun_eklenen: 7588,
};
const rowOzelge: KorpusTazelikRow = {
  korpus: 'ozelge',
  son_guncelleme: '2026-11-04T00:00:00+00:00',
  en_yeni_belge: '2026-08-07',
  son_30_gun_eklenen: 7,
};

function fakeClient(res: { data?: unknown; error?: unknown } = { data: [rowDanistay, rowOzelge] }) {
  const select = vi.fn(() => Promise.resolve({ data: res.data ?? null, error: res.error ?? null }));
  return { from: vi.fn(() => ({ select })) };
}

describe('parseTazelikKeys', () => {
  it('boşluk / büyük harf / bilinmeyen ve tazeliği olmayan anahtarları ayıklar', () => {
    expect([...parseTazelikKeys(' Danistay , kanunlar,')]).toEqual(['danistay']);
    expect([...parseTazelikKeys('danistay,ozelgeler')].sort()).toEqual(['danistay', 'ozelgeler']);
  });
  it('boş ya da yok → kapalı', () => {
    expect(parseTazelikKeys(undefined).size).toBe(0);
    expect(parseTazelikKeys('').size).toBe(0);
    expect(parseTazelikKeys(' , ').size).toBe(0);
  });
});

describe('tazelikOku', () => {
  it('ayar boşken view sorgulanmaz', async () => {
    const c = fakeClient();
    expect(await tazelikOku(new Set(), c as never)).toEqual([]);
    expect(c.from).not.toHaveBeenCalled();
  });
  it('ayar doluyken korpus_tazelik okunur', async () => {
    const c = fakeClient();
    expect(await tazelikOku(new Set(['danistay']), c as never)).toEqual([rowDanistay, rowOzelge]);
    expect(c.from).toHaveBeenCalledWith('korpus_tazelik');
  });
  it('Supabase hata nesnesinin mesajı loga yazılır', async () => {
    const { logger } = await import('../src/config/logger.js');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    // PostgrestError düz nesnedir (Error değil) — String(err) '[object Object]' verir.
    const c = fakeClient({ error: { message: 'relation "public.korpus_tazelik" does not exist', code: '42P01' } });
    await tazelikOku(new Set(['danistay']), c as never);
    expect(JSON.stringify(warn.mock.calls[0])).toContain('korpus_tazelik\\" does not exist');
    warn.mockRestore();
  });
  it('view hatası fail-open', async () => {
    const c = fakeClient({ error: new Error('relation "korpus_tazelik" does not exist') });
    expect(await tazelikOku(new Set(['danistay']), c as never)).toEqual([]);
  });
});

describe('tazelikEkle', () => {
  it('yalnız açık kategoriye eklenir; diğerlerinde anahtar hiç yok', () => {
    const out = tazelikEkle(CATS, [rowDanistay, rowOzelge], new Set(['danistay']));
    expect(out.find((c) => c.key === 'danistay')!.tazelik).toEqual({
      son_guncelleme: '2026-09-21',
      en_yeni_belge: '2026-06-10',
      son_30_gun_eklenen: 7588,
    });
    expect('tazelik' in out.find((c) => c.key === 'ozelgeler')!).toBe(false);
    expect('tazelik' in out.find((c) => c.key === 'kanunlar')!).toBe(false);
  });
  it('ayar kapalıyken giriş birebir döner', () => {
    expect(tazelikEkle(CATS, [rowDanistay], new Set())).toEqual(CATS);
  });
  it('satırı olmayan açık kategoriye eklenmez', () => {
    const out = tazelikEkle(CATS, [rowDanistay], new Set(['danistay', 'ozelgeler']));
    expect('tazelik' in out.find((c) => c.key === 'ozelgeler')!).toBe(false);
  });
  it('istanbul gününe çevirir', () => {
    const out = tazelikEkle(
      CATS,
      [{ ...rowDanistay, son_guncelleme: '2026-11-22T22:30:00+00:00' }],
      new Set(['danistay'])
    );
    expect(out.find((c) => c.key === 'danistay')!.tazelik!.son_guncelleme).toBe('2026-11-23');
  });
});
