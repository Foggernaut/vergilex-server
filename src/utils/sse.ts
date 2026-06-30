import type { Response } from 'express';

/**
 * Minimal Server-Sent Events writer over an Express response.
 * Frames are `event: <name>\ndata: <json>\n\n`; `ping()` sends a `: comment`
 * heartbeat so intermediary proxies never treat the socket as idle.
 */
export class SseWriter {
  private closed = false;

  constructor(private readonly res: Response) {}

  init(): void {
    this.res.status(200);
    this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    this.res.setHeader('Cache-Control', 'no-cache, no-transform');
    this.res.setHeader('Connection', 'keep-alive');
    // Disable proxy buffering (nginx/Railway edge) so events flush immediately.
    this.res.setHeader('X-Accel-Buffering', 'no');
    this.res.flushHeaders?.();
    // Disable Nagle so each small SSE frame is sent on the wire immediately
    // instead of being coalesced (the #1 cause of "everything arrives at once").
    this.res.socket?.setNoDelay(true);
  }

  event(event: string, data: unknown): void {
    if (this.closed || this.res.writableEnded) return;
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    // data may contain newlines (e.g. an answer chunk) — split into data: lines.
    const lines = payload.split('\n').map((l) => `data: ${l}`).join('\n');
    this.res.write(`event: ${event}\n${lines}\n\n`);
    // Force an explicit flush when a compression layer is present (no-op otherwise).
    (this.res as unknown as { flush?: () => void }).flush?.();
  }

  ping(): void {
    if (this.closed || this.res.writableEnded) return;
    this.res.write(': ping\n\n');
    (this.res as unknown as { flush?: () => void }).flush?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.res.writableEnded) this.res.end();
  }

  get isClosed(): boolean {
    return this.closed || this.res.writableEnded;
  }
}
