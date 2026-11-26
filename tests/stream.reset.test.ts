import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrainStreamEvent } from '../src/brain/brain.types.js';
import type * as BrainClientModulu from '../src/brain/brain.client.js';

// Brain (mevzuat-knowledge-api) bir model reddinde akan taslağı atar ve yedek modelle yeniden
// akıtır; bunu `answer_reset` (Hızlı) / `layer3_reset` (Asistan) olayıyla bildirir. Relay bu
// olayları düşürürse kullanıcı reddedilen kısmi metnin ardına eklenmiş yeni metni görür
// (`complete` gelene kadar).

let olaylar: BrainStreamEvent[] = [];

vi.mock('../src/brain/brain.client.js', async (orijinal) => {
  const gercek = await orijinal<typeof BrainClientModulu>();
  async function* akis() {
    for (const e of olaylar) yield e;
  }
  return {
    ...gercek,
    brainClient: { answerV2Stream: () => akis(), assistantAnswerStream: () => akis() },
  };
});

function sahteSse() {
  const yazilan: Array<[string, unknown]> = [];
  return {
    yazilan,
    sse: {
      init: vi.fn(),
      ping: vi.fn(),
      close: vi.fn(),
      event: vi.fn((ad: string, veri: unknown) => {
        yazilan.push([ad, veri]);
      }),
    },
  };
}

const tamam = {
  type: 'complete',
  response: { answer: 'yedek', sources: [] },
} as unknown as BrainStreamEvent;

describe('parseBrainSseFrame — sıfırlama olayları', () => {
  it('answer_reset ve layer3_reset tanınır; bilinmeyen olay null', async () => {
    const { parseBrainSseFrame } = await import('../src/brain/brain.client.js');
    expect(parseBrainSseFrame('event: answer_reset\ndata: {}')).toEqual({ type: 'answer_reset' });
    expect(parseBrainSseFrame('event: layer3_reset\ndata: {}')).toEqual({ type: 'layer3_reset' });
    expect(parseBrainSseFrame('event: bilinmeyen\ndata: {}')).toBeNull();
    expect(parseBrainSseFrame('event: answer_delta\ndata: {"text":"a"}')).toEqual({
      type: 'answer_delta',
      text: 'a',
    });
  });
});

describe('relay — sıfırlama olayı istemciye iletilir', () => {
  beforeEach(() => {
    olaylar = [];
  });

  it('Hızlı (chat) answer_reset sırasıyla iletir', async () => {
    olaylar = [
      { type: 'answer_delta', text: 'reddedilen' },
      { type: 'answer_reset' },
      { type: 'answer_delta', text: 'yedek' },
      tamam,
    ];
    const { pipe } = await import('../src/modules/chat/chat.stream.service.js');
    const { sse, yazilan } = sahteSse();
    await pipe(sse as never, new AbortController().signal, {} as never, async () => ({ message: {} }) as never);
    const adlar = yazilan.map(([ad]) => ad);
    expect(adlar).toEqual(['answer_delta', 'answer_reset', 'answer_delta', 'complete']);
  });

  it('Asistan layer3_reset sırasıyla iletir', async () => {
    olaylar = [
      { type: 'layer3_delta', text: 'reddedilen' },
      { type: 'layer3_reset' },
      { type: 'layer3_delta', text: 'yedek' },
      tamam,
    ];
    const { pipe } = await import('../src/modules/assistant/assistant.stream.service.js');
    const { sse, yazilan } = sahteSse();
    await pipe(sse as never, new AbortController().signal, {} as never, async () => ({ message: {} }) as never);
    const adlar = yazilan.map(([ad]) => ad);
    expect(adlar).toEqual(['layer3_delta', 'layer3_reset', 'layer3_delta', 'complete']);
  });
});
