# Workflows

## Record Lifecycle

1. **Submission**
   - Player submits a replay UUID or link via the Discord bot (`!upload`).
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
