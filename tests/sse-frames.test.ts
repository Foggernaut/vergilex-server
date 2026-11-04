import { describe, it, expect } from 'vitest';
import { sseFrames } from '../src/utils/sse.js';

// Brain SSE akışı ağ parçaları hâlinde gelir; parça sınırı çok-baytlı bir UTF-8 harfinin
// (ı = 0xC4 0xB1) ortasına düşebilir. Parça başına decode eden eski kod "davac��" üretiyordu
// (canlı: Sohbet 1/354, Üç Aşamalı 4/104 cevap).

async function* parcalar(...chunks: Uint8Array[]) {
  for (const c of chunks) yield c;
}

async function topla(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const f of it) out.push(f);
  return out;
}

describe('sseFrames', () => {
  it('çok-baytlı harf parça sınırında bölünse de bozulmaz', async () => {
    const bytes = Buffer.from('event: delta\ndata: {"t":"davacı"}\n\n', 'utf8');
    const i = bytes.indexOf(0xc4) + 1; // 'ı'nın iki baytı arasından böl
    const frames = await topla(sseFrames(parcalar(bytes.subarray(0, i), bytes.subarray(i))));
    expect(frames).toEqual(['event: delta\ndata: {"t":"davacı"}']);
    expect(frames.join('')).not.toContain('�');
  });

  it('çerçeveleri boş satırdan ayırır, yarım çerçeveyi bir sonraki parçaya taşır', async () => {
    const frames = await topla(sseFrames(parcalar(
      Buffer.from('event: a\ndata: 1\n\nevent: b\nda'), Buffer.from('ta: 2\n\n'),
    )));
    expect(frames).toEqual(['event: a\ndata: 1', 'event: b\ndata: 2']);
  });

  it('parça sınırına düşen \\r\\n ayracını da tanır', async () => {
    const frames = await topla(sseFrames(parcalar(
      Buffer.from('event: a\r\ndata: 1\r\n\r'), Buffer.from('\nevent: b\r\ndata: 2\r\n\r\n'),
    )));
    expect(frames).toEqual(['event: a\ndata: 1', 'event: b\ndata: 2']);
  });
});
