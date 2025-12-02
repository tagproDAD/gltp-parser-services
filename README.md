# GLTP Backend Ecosystem

Gravity League TagPro (GLTP) is a community-driven speedrunning ecosystem built around TagPro gravity maps.  
This backend repository powers record submission, parsing, validation, and storage for GLTP speedruns, lowest-jumps challenges, and league play.

---

## 🚀 Overview

The system consists of several components working together:

- **Cloudflare Worker** → API gateway for record submission and retrieval.
- **Cloudflare D1 Database** → Stores all records, incomplete runs, no-player runs, and error logs.
- **Vercel Parser Service** → Single source of truth for replay parsing (avoids Cloudflare CPU limits).
- **Replay Parser** → Extracts structured data from TagPro replays (caps, jumps, players, etc.).
- **Spreadsheet Integration** → Loads map metadata (caps-to-win, categories, presets).
- **Discord Bot** → Allows players to submit and check records directly in Discord.
- **Local Scripts** → Developer utilities for migration, verification, and testing.

**Workflow:**

Discord Bot → Cloudflare Worker → Vercel Parser → TagPro → Vercel → Cloudflare Worker → D1 Database

---

## 📂 Repository Structure

workers/worker.js # Cloudflare Worker entrypoint 
workers/db/ # DB insert helpers 
workers/utils/ # Response + formatting utilities 
api/parse.js # Vercel API handler 
lib/replayParser.js # Core replay parsing logic for vercel 
lib/spreadsheet.js # Map metadata loader for vercel
lib/validation.js # Input validation helpers for vercel 
discordScripts # Discord bot + sanitization 
localsrc/upload.js # Local migration + testing 
docs/architecture.md # System components + data flow 
docs/workflows.md # Record lifecycle + error handling 
docs/schema.md # Database schema + payload format 
docs/dev-setup.md # Local development + testing 
docs/migration.md # JSON → D1 migration notes


---

## 🗄️ Database Schema

The Cloudflare D1 database has four tables:

- `gltp_records` → Completed runs (primary dataset).
- `gltp_incomplete_records` → Runs ended prematurely.
- `gltp_no_player_records` → Runs with no players.
- `gltp_errors` → Parser/DB errors.

All tables enforce **unique UUIDs**.  
Payloads are stored as JSON blobs for flexibility.

---

## 🔌 API Endpoints (Cloudflare Worker)

- `POST /parse` → Parse and insert a record (delegates to Vercel).
- `POST /check-uuids` → Verify UUIDs across all record tables.
- `POST /check-errors` → Verify UUIDs against error table.
- `GET /records` → Fetch completed records.
- `GET /incomplete-records` → Fetch incomplete runs.
- `GET /noplayers` → Fetch runs with no players.

---

## 🤖 Discord Bot

Commands:
- `!upload <uuid|link>` → Uploads a record to the database.
- `!check <uuid|link>` → Parses a replay and displays record details.

Features:
- ✅ Inserts completed runs
- ⚠️ Detects duplicates
- ❌ Flags invalid inputs
- 📦 Startup catch-up ensures missed submissions are processed

---

## 🛠️ Local Scripts

`scripts/upload.js` provides developer utilities:

- `parse` → Upload UUIDs to Worker `/parse`.
- `check` → Verify UUIDs across record tables.
- `checkErrors` → Verify UUIDs against error table.
- `extract` → Extract UUIDs from old JSON records.
- `sanitizeText` → Convert raw text dump into JSON.
- `sanitize` → Convert missing-records.json into JSON.
- `compare` → Deep compare old vs. new records.

---

## 🧪 Local Development & Testing

### Cloudflare Worker
- Install Wrangler: `npm install -g wrangler`
- Run locally: `wrangler dev`
- Deploy: `wrangler publish`
- Test:
  ```bash
  curl -X POST http://localhost:8787/parse \
    -H "Content-Type: application/json" \
    -d '{"input":"<uuid>"}'


### Vercel Parser
- Install Vercel CLI: npm i -g vercel
- Run locally: vercel dev
- Deploy: vercel deploy
- Test:
curl -X POST http://localhost:3000/api/parse \
  -H "Content-Type: application/json" \
  -d '{"input":"<uuid>"}'

### Discord Bot
- Run locally: node bot.js
- Requires DISCORD_TOKEN and channel IDs in env.
- Use !upload <uuid> or !check <uuid> in Discord.
- Accepts UUID or replay url

### 📖 Further Documentation
See the docs/ folder for detailed information:

Architecture → System components + data flow

Workflows → Record lifecycle + error handling

Schema → Database schema + payload format

Dev Setup → Local development + testing

Migration → JSON → D1 migration notes

### 🌐 Related Repositories
GLTP Website → Frontend for maps, leaderboards, profiles, and league play. (link to website repo here)

### Status
- JSON → D1 migration complete (~7,100 records + ~40,000 UUIDs processed).

- Worker + Vercel parser stable.

- Discord bot live for record submission.

- Website consumes data from gltp_records. 

### License
MIT License.