# Development Setup

## Requirements
- Node.js (latest LTS recommended)
- Wrangler CLI (for Cloudflare Workers)
- Vercel CLI (for parser service)
- Discord bot token + channel IDs
- Access to Cloudflare D1 database

---

## Cloudflare Worker

Install Wrangler:
npm install -g wrangler

Run locally:
wrangler dev

Deploy:
wrangler publish

Test locally:
curl -X POST http://localhost:8787/parse \
  -H "Content-Type: application/json" \
  -d '{"input":"<uuid>"}'

---

## Vercel Parser

Install Vercel CLI:
npm install -g vercel

Run locally:
vercel dev

Deploy:
vercel deploy

Test locally:
curl -X POST http://localhost:3000/api/parse \
  -H "Content-Type: application/json" \
  -d '{"input":"<uuid>"}'

---

## Discord Bot

Run locally:
node bot.js

Environment variables (.env):
- DISCORD_TOKEN → Bot token
- CHANNELS → Channel IDs for submissions
- WORKER_URL → Cloudflare Worker endpoint

Commands:
- !upload <uuid|link> → Uploads a record to the database.
- !check <uuid|link> → Parses a replay and displays record details.

---

## Notes on Rate Limits & Logging

Rate limits:
- Sleep ~3s between parse requests.
- Sleep ~1s between check requests.
- Prevents hitting TagPro or Cloudflare API limits.
- Was not tested heavily because I got bored of getting blocked

Logging:
- Free tiers (Cloudflare + Vercel) have limited logging.
- Use local dev servers for debugging and structured logs.

---

## Local Scripts

- `parse` → Upload UUIDs to Worker /parse
- `parseVercel` → Upload UUIDs directly to Vercel parser
- `check` → Verify UUIDs across record tables
- `checkErrors` → Verify UUIDs against error table
- `extract` → Extract UUIDs from old JSON
- `sanitizeText` → Convert raw text dump into JSON
- `sanitize` → Convert missing-records.json into JSON
- `compare` → Deep compare old vs. new records
- `delete` → Remove records by UUID or map_id
- `mapFix` → Re‑parse and fix records with capsToWin edge cases
- `pipeline` → End‑to‑end workflow: sanitize → check → error check → parse

Scripts produce local JSON artifacts for auditability (parsed results, missing UUIDs).
