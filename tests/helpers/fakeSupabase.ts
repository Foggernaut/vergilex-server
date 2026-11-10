// Tabloya duyarlı, zincirlenebilir, thenable sahte supabase-js (yalnız bu testlerin kullandığı yüzey).
// `from(table)` → select / insert / delete + .eq .in .gte .lt .order .range .abortSignal .single .maybeSingle.
// Satırlar bellekte tutulur (gerçek süzme/silme davranışı sınanır); her çağrı `calls`'a düşer: tablo,
// işlem, select argümanı, insert payload'ı, süzgeçler, abortSignal.

export type Row = Record<string, unknown>;

export interface FakeFilter {
  op: 'eq' | 'in' | 'gte' | 'lt';
  column: string;
  value: unknown;
}

export interface FakeCall {
  table: string;
  op: 'select' | 'insert' | 'delete';
  /** select(...) argümanı; insert(...).select(...) için döndürülen sütunlar. */
  columns: string | null;
  payload: unknown;
  filters: FakeFilter[];
  single: 'single' | 'maybeSingle' | null;
  signal: AbortSignal | undefined;
}

interface FakeResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

const toTime = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

function compare(a: unknown, b: unknown): number {
  const ta = toTime(a);
  const tb = toTime(b);
  if (ta !== null && tb !== null) return ta - tb;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function matches(row: Row, f: FakeFilter): boolean {
  const v = row[f.column];
  switch (f.op) {
    case 'eq':
      return v === f.value;
    case 'in':
      return Array.isArray(f.value) && f.value.includes(v);
    case 'gte':
      return v != null && compare(v, f.value) >= 0;
    case 'lt':
      return v != null && compare(v, f.value) < 0;
  }
}

function project(row: Row, columns: string | null): Row {
  if (!columns || columns.trim() === '*') return { ...row };
  const out: Row = {};
  for (const c of columns.split(',').map((s) => s.trim())) out[c] = row[c];
  return out;
}

class Builder implements PromiseLike<FakeResult> {
  private readonly call: FakeCall;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private rangeFrom: [number, number] | null = null;

  constructor(
    private readonly fake: FakeSupabase,
    table: string
  ) {
    this.call = {
      table,
      op: 'select',
      columns: null,
      payload: undefined,
      filters: [],
      single: null,
      signal: undefined,
    };
  }

  select(columns = '*') {
    this.call.columns = columns;
    return this;
  }
  insert(payload: unknown) {
    this.call.op = 'insert';
    this.call.payload = payload;
    return this;
  }
  delete() {
    this.call.op = 'delete';
    return this;
  }
  eq(column: string, value: unknown) {
    this.call.filters.push({ op: 'eq', column, value });
    return this;
  }
  in(column: string, value: unknown[]) {
    this.call.filters.push({ op: 'in', column, value });
    return this;
  }
  gte(column: string, value: unknown) {
    this.call.filters.push({ op: 'gte', column, value });
    return this;
  }
  lt(column: string, value: unknown) {
    this.call.filters.push({ op: 'lt', column, value });
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending ?? true };
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = [from, to];
    return this;
  }
  abortSignal(signal: AbortSignal) {
    this.call.signal = signal;
    return this;
  }
  single() {
    this.call.single = 'single';
    return this;
  }
  maybeSingle() {
    this.call.single = 'maybeSingle';
    return this;
  }

  then<R1 = FakeResult, R2 = never>(
    onFulfilled?: ((value: FakeResult) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return this.run().then(onFulfilled, onRejected);
  }

  private async run(): Promise<FakeResult> {
    const { call } = this;
    this.fake.calls.push(call);
    const key = `${call.table}:${call.op}`;

    const gate = this.fake.gates.get(key);
    if (gate) await gate;

    const failure = this.fake.failures.get(key);
    if (failure instanceof Error) throw failure;
    if (failure) return { data: null, error: failure };

    const rows = this.fake.tableRows(call.table);
    const hit = (r: Row) => call.filters.every((f) => matches(r, f));

    if (call.op === 'insert') {
      const payload = (call.payload ?? {}) as Row;
      const row: Row = {
        id: this.fake.nextId(),
        created_at: new Date().toISOString(),
        ...payload,
      };
      rows.push(row);
      return this.shape(call.columns ? [project(row, call.columns)] : []);
    }

    if (call.op === 'delete') {
      this.fake.tables.set(
        call.table,
        rows.filter((r) => !hit(r))
      );
      return { data: null, error: null };
    }

    let found = rows.filter(hit);
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      found = [...found].sort((a, b) => (ascending ? 1 : -1) * compare(a[column], b[column]));
    }
    if (this.rangeFrom) found = found.slice(this.rangeFrom[0], this.rangeFrom[1] + 1);
    return this.shape(found.map((r) => project(r, call.columns)));
  }

  private shape(rows: Row[]): FakeResult {
    const { single } = this.call;
    if (single === 'maybeSingle') return { data: rows[0] ?? null, error: null };
    if (single === 'single') {
      return rows[0]
        ? { data: rows[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    }
    return { data: rows, error: null };
  }
}

export class FakeSupabase {
  calls: FakeCall[] = [];
  tables = new Map<string, Row[]>();
  failures = new Map<string, Error | { code?: string; message?: string }>();
  gates = new Map<string, Promise<void>>();
  private counter = 0;

  from(table: string) {
    return new Builder(this, table);
  }

  tableRows(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  /** Bellekteki tablo satırları (insert/delete sonrası güncel hâl). */
  rows(table: string): Row[] {
    return [...this.tableRows(table)];
  }

  seed(table: string, rows: Row[]) {
    this.tableRows(table).push(...rows);
  }

  /** O tablo+işlem hata nesnesi döndürür ({error}); Error verilirse söz reddedilir. */
  failOn(
    table: string,
    op: FakeCall['op'],
    failure: Error | { code?: string; message?: string }
  ) {
    this.failures.set(`${table}:${op}`, failure);
  }

  /** O tablo+işlem, dönen fonksiyon çağrılana dek bekler (yanıt-sonrası kayıt sırasını sınamak için). */
  holdOn(table: string, op: FakeCall['op']): () => void {
    let release!: () => void;
    this.gates.set(
      `${table}:${op}`,
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    return release;
  }

  callsFor(table: string, op?: FakeCall['op']): FakeCall[] {
    return this.calls.filter((c) => c.table === table && (!op || c.op === op));
  }

  nextId(): string {
    this.counter += 1;
    return `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`;
  }

  reset() {
    this.calls = [];
    this.tables = new Map();
    this.failures = new Map();
    this.gates = new Map();
    this.counter = 0;
  }
}

export const fakeSupabase = new FakeSupabase();
