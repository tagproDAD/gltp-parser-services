# Architecture

## Overview
This backend powers GLTP record submission, parsing, validation, and storage. Parsing is centralized to vercel to avoid Cloudflare CPU limits, and every replay UUID is tracked across completion, incomplete, no-player, and error cases.

## Components
- **Cloudflare Worker**
  - API gateway for ingest and retrieval.
  - Delegates parsing to the Vercel parser service.
  - Inserts into D1 tables based on outcome (completed, incomplete, no-player, errors).
  - Provides verification endpoints for migration and operational checks.

- **Cloudflare D1 database**
  - Tables:
    - `gltp_records` → Completed runs.
    - `gltp_incomplete_records` → Runs not finished or missing `record_time`/capping player.
    - `gltp_no_player_records` → Games where no players joined.
    - `gltp_errors` → Parser/DB errors logged by UUID and message.
  - Stores full record payloads as JSON blobs. UUIDs are unique to prevent duplicates and enable end-to-end reconciliation.

- **Vercel parser service**
  - Single source of truth for replay parsing (UUID or replay link).
  - Fetches replay metadata and lines from TagPro and produces a structured record payload.
  - Adds `origin` and `timestamp_uploaded` for traceability.

- **Replay parser (`lib/replayParser.js`)**
  - Validates replay format and extracts:
    - Map info (`map_name`, `map_author`, `actual_map_id`).
    - Players.
    - Cap detection according to map rules (caps-to-win, red-only unless `allow_blue_caps`).
    - `record_time` (first valid cap vs. timer start), `capping_player`, `capping_player_user_id`.
    - `total_jumps` counted up to the cap timestamp.
    - Last chat from the capping player.
  - Resolves `map_id` using spreadsheet data, including `equivalent_map_ids`.

- **Spreadsheet integration (`lib/spreadsheet.js`)**
  - Loads and caches map metadata from a Google Sheets CSV export.
  - Fields include `map_id`, `equivalent_map_ids`, `caps_to_win`, `allow_blue_caps`, category/preset, and player requirements.

- **Discord bot**
  - Commands:
    - `!upload <uuid|link>` → submits UUID/link to Worker `/parse`.
    - `!check <uuid|link>` → validates and previews parsed result without inserting.
  - Startup catch-up to process missed submissions since last run.
  - Sanitizes inputs and gives immediate feedback (inserted, duplicate, invalid, error).

- **Local scripts (`scripts/upload.js`)**
  - Modes for migration and verification: `parse`, `check`, `checkErrors`, `extract`, `sanitizeText`, `sanitize`, `compare`.
  - Respect rate limits via sleep delays.
  - Produce local JSON artifacts for audit (parsed results, missing UUIDs).

## Data Flow

Discord Bot
   ↓ (submit UUID)
Cloudflare Worker (API gateway)
   ↓ (forward to parser)
Vercel Parser (business logic)
   ↓ (fetch replay data)
TagPro API (source of truth)
   ↓ (parsed payload returned)
Cloudflare Worker (validation + routing)
   ↓ (insert into correct table)
Cloudflare D1 Database

- Normal path: Discord → Worker → Vercel → TagPro → Vercel → Worker → D1.
- Worker decides destination table:
  - Completed → `gltp_records`.
  - Incomplete (players present, not finished) → `gltp_incomplete_records`.
  - No players → `gltp_no_player_records`.
  - Errors (parser/DB) → `gltp_errors`.

## Worker API Surface
- `POST /parse` → Delegates to Vercel; inserts into the correct table; returns summary and upload status (`201 inserted`, `409 duplicate`).
- `POST /check-uuids` → Batch verify UUIDs across `records`, `incomplete`, `noplayers` with source counts and missing list. Max batch size: 100.
- `POST /check-errors` → Batch verify against `gltp_errors`. Validates UUID format; returns existing/missing.
- `GET /records` → All completed payloads.
- `GET /incomplete-records` → All incomplete payloads.
- `GET /noplayers` → All no-player payloads.
- `OPTIONS /*` → CORS preflight.

Responses are standardized with `jsonResponse`/`errorResponse`. Summaries are produced via `formatShortSummary` for lightweight feedback.

## Parsing Rules and Payload
- Cap detection adheres to:
  - `caps_to_win` from spreadsheet; `"pups"` is treated as no finite requirement (`null` in code).
  - Red caps only unless `allow_blue_caps` is true.
- Timer start from first `"time"` event with `state === 1`; record time is cap timestamp minus this start.
- Jumps counted via `"replayPlayerMessage"` events of `type: "sound", data.s: "jump"` up to cap timestamp.
- Payload fields commonly include:
  - `map_name`, `map_id`, `actual_map_id`, `map_author`
  - `players[]` with `{ name, user_id, is_red }`
  - `capping_player`, `capping_player_user_id`
  - `record_time` (ms), `is_solo`, `timestamp`, `uuid`
  - `capping_player_quote`, `caps_to_win`, `allow_blue_caps`, `total_jumps`
  - `origin`, `timestamp_uploaded` (added at submission)

## Map ID Resolution Nuance
- Replay’s `actual_map_id` is extracted from `mapfile`.
- Final `map_id` is resolved via spreadsheet:
  - Direct `map_id` match when available.
  - Fallback to `equivalent_map_ids` for maps with alternate identifiers.
- This ensures consistent linking of records to the canonical map entry used by the website and analytics.

## Resilience and Auditability
- UUID uniqueness across tables prevents duplicates and simplifies reconciliation.
- All outcomes logged:
  - Completed, incomplete, no-player, and errors — nothing is dropped unless cloudflare error.
- Verification endpoints and local scripts provide end-to-end checks:
  - Presence across tables, missing lists, and deep comparisons with legacy JSON.
  - Client (discord/website/other) needs to do final verification

## Deployment and Local Testing Notes
- **Cloudflare Worker (Wrangler)**
  - Run locally: `wrangler dev`
  - Deploy: `wrangler publish`
  - Test: `curl -X POST http://localhost:8787/parse -H "Content-Type: application/json" -d '{"input":"<uuid>"}'`
- **Vercel parser**
  - Run locally: `vercel dev`
  - Deploy: `vercel deploy`
  - Test: `curl -X POST http://localhost:3000/api/parse -H "Content-Type: application/json" -d '{"input":"<uuid>"}'`
- **Rate limits & logging**
  - TagPro and Cloudflare can rate limit; scripts use sleeps (3s for parse, 1s for checks).
  - Logging on free tiers is limited; use local dev servers for debugging.

## Related Repositories
- GLTP Website (maps, leaderboards, profiles, league): https://github.com/BambiTP/GLTP

