# vergilex-server

Product server for Vergilex. Owns user accounts, credits, conversations, favorites, and search history. Calls the friend's `mevzuat-knowledge-api` brain server for AI-powered search and chat.

## Stack
- Node 20 + Express 4 + TypeScript (strict)
- Supabase (Postgres + Auth) — Product DB
- Zod for runtime validation
- Winston for logging
- undici for HTTP to brain server
- Vitest for tests

## Setup

```bash
cp .env.example .env
# Fill in SUPABASE_*, BRAIN_*, CORS_ORIGIN
npm install
```

### Run migrations
Apply SQL files in `supabase/migrations/` in order against your Supabase Product DB project (via the Supabase dashboard SQL editor or `supabase db push` if linked).

### Dev
```bash
npm run dev          # tsx watch
```

### Build & run
```bash
npm run build
npm start
```

### Tests
```bash
npm test
npm run typecheck
npm run lint
```

## API surface
See `/Users/atillaokumus/.claude/plans/here-in-this-folder-mutable-lobster.md` §2.5 for the full table.

| Method | Path                              | Auth | Credits |
|--------|-----------------------------------|------|---------|
| POST   | `/api/auth/signup`                | —    | 0       |
| POST   | `/api/auth/login`                 | —    | 0       |
| POST   | `/api/auth/logout`                | JWT  | 0       |
| GET    | `/api/auth/me`                    | JWT  | 0       |
| GET    | `/api/user/profile`               | JWT  | 0       |
| PATCH  | `/api/user/profile`               | JWT  | 0       |
| GET    | `/api/user/credits`               | JWT  | 0       |
| GET    | `/api/user/history`               | JWT  | 0       |
| POST   | `/api/chat`                       | JWT  | 5       |
| POST   | `/api/chat/:id/follow-up`         | JWT  | 3       |
| GET    | `/api/chat/conversations`         | JWT  | 0       |
| GET    | `/api/chat/conversations/:id`     | JWT  | 0       |
| DELETE | `/api/chat/conversations/:id`     | JWT  | 0       |
| POST   | `/api/belge-bul`                  | JWT  | 2       |
| GET    | `/api/favorites`                  | JWT  | 0       |
| POST   | `/api/favorites`                  | JWT  | 0       |
| DELETE | `/api/favorites/:id`              | JWT  | 0       |
| GET    | `/health`                         | —    | 0       |

## Deployment
Railway, same project as the brain server. Brain URL via internal DNS:
`BRAIN_API_URL=http://mevzuat-knowledge-api.railway.internal:PORT`
