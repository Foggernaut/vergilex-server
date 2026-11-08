// Tam metin önbelleği (maliyet kontrolü). Korpus metni içe aktarmalar arasında değişmez, ama tam
// metinler büyüktür (tebliğin bütün belgesi ~1,4M karakter olabilir): TTL ve kayıt sayısı yetmez,
// toplam karakter sınırı da gerekir. Taşmada en eski kayıt atılır (Map ekleme sırası = yaşlılık).

interface Entry {
  at: number;
  chars: number;
  value: unknown;
}

export class TextCache {
  private readonly entries = new Map<string, Entry>();
  private totalChars = 0;

  constructor(
    private readonly opts: { ttlMs: number; maxEntries: number; maxTotalChars: number }
  ) {}

  get(key: string): unknown | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= this.opts.ttlMs) {
      this.remove(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: unknown, chars: number): void {
    this.remove(key); // aynı anahtar: eski boyutu düş, kayıt en yeni sıraya geçsin
    // Tek başına sınırı aşan kayıt önbelleğe alınmaz (diğerlerini de boşuna atmasın).
    if (chars > this.opts.maxTotalChars) return;

    this.dropExpired();
    this.entries.set(key, { at: Date.now(), chars, value });
    this.totalChars += chars;

    while (this.entries.size > this.opts.maxEntries || this.totalChars > this.opts.maxTotalChars) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
  }

  private remove(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.totalChars -= e.chars;
    this.entries.delete(key);
  }

  private dropExpired(): void {
    const now = Date.now();
    for (const [k, e] of this.entries) {
      if (now - e.at >= this.opts.ttlMs) this.remove(k);
    }
  }
}
