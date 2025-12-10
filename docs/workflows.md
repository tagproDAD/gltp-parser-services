# Workflows

## Record Lifecycle

1. **Submission**
   - Player submits a replay UUID or link via the Discord bot, website, grav bot, or other client.
   - Bot sends the UUID to the Cloudflare Worker `/parse` endpoint.

2. **Parsing**
   - Worker delegates parsing to the Vercel parser service.
   - Vercel fetches replay data from TagPro and applies parsing rules.
   - Parser returns a structured record payload.

3. **Insertion**
   - Worker decides destination table based on outcome:
     - `gltp_records` → Completed runs
     - `gltp_incomplete_records` → Runs ended prematurely
     - `gltp_no_player_records` → Runs with no players
     - `gltp_errors` → Parser/DB errors

4. **Feedback**
   - Worker responds with a summary (map, player, time).
   - Discord bot displays the summary to the user.

### Delayed Uploads

- **Endpoint**: `POST /delayed-upload`
- **Purpose**: Queue UUIDs at game start to avoid premature parsing.
- **Storage**: UUIDs saved in Cloudflare KV (`DELAYED_REPLAYS`) with timestamp and origin.
- **Processing**: Cron job runs every 15 minutes, checks KV entries, and processes UUIDs ≥65 minutes old.
- **Outcome**:
  - Success → record inserted into DB, KV entry removed.
  - Failure → KV entry retained for retry on next cron run.

---


## Error Handling

- **Incomplete runs**  
  Logged in `gltp_incomplete_records`.

- **No players**  
  Logged in `gltp_no_player_records`.

- **Parser/DB errors**  
  Logged in `gltp_errors`.

- **Duplicate UUIDs**  
  Worker returns `409 Conflict` and does not insert.

### Special Handling: capsToWin > 1

- Team modes now accumulate caps per side.
- Non‑team modes require a single player to reach `caps_to_win`.
- Older records parsed incorrectly may need cleanup via `mapFix.js`.

## Verification Workflows

- **Check UUIDs**
  - Endpoint: `POST /check-uuids`
  - Verifies UUIDs across `records`, `incomplete`, and `noplayers`.
  - Returns:
    - `sourceCounts` → how many UUIDs found in each table
    - `missing` → list of UUIDs not found
  - Max batch size: 100 UUIDs.

- **Check Errors**
  - Endpoint: `POST /check-errors`
  - Verifies UUIDs against `gltp_errors`.
  - Returns:
    - `existing` → UUIDs found in error table
    - `missing` → UUIDs not found
  - Validates UUID format before checking.

- **mapFix compare** → Ensures DB records match parser output after logic changes (e.g. capsToWin fix).

- **upload pipeline** → Automates sanitize → check → error check → parse in one run.
- **delete mode** → Removes bad records by UUID or map_id.
- **parseVercel mode** → Allows direct comparison against parser output without Worker routing.

---

## Local Script Support

`scripts/upload.js` provides developer utilities:

- `parse` → Upload UUIDs to Worker `/parse`.
- `check` → Verify UUIDs across record tables.
- `checkErrors` → Verify UUIDs against error table.
- `extract` → Extract UUIDs from old JSON records.
- `sanitizeText` → Convert raw text dump into JSON.
- `sanitize` → Convert missing-records.json into JSON.
- `compare` → Deep compare old vs. new records.

Scripts respect rate limits:
- Sleep ~3s between parse requests.
- Sleep ~1s between check requests.

---

## Operational Notes

- **Auditability**  
  Every replay UUID is tracked in one of the four tables.

- **Resilience**  
  Verification endpoints + local scripts ensure no UUID is lost during migration or live ingestion.

- **Transparency**  
  Summaries provide quick feedback for Discord bot and migration logs.
