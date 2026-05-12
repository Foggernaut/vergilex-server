// Vitest setup — set safe defaults for env vars used by config/env.ts
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.PORT = process.env.PORT ?? '3001';
process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'test-anon-key';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? 'test-service-key';
process.env.BRAIN_API_URL = process.env.BRAIN_API_URL ?? 'http://localhost:8000';
process.env.BRAIN_API_KEY = process.env.BRAIN_API_KEY ?? 'test-brain-key';
