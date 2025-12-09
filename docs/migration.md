# Migration

## Background
- Old system: static JSON file (~7,100 completed records).
- New system: Cloudflare D1 database (~40,000 UUIDs processed).
- Goal: capture every UUID, handle errors, and ensure auditability.

---

## Migration Steps

1. **Extract UUIDs**
   - Use `extract` mode in `scripts/upload.js` to pull UUIDs from old JSON.

2. **Sanitize UUIDs**
   - Use `sanitizeText` mode to convert raw text dumps into JSON.
   - Use `sanitize` mode to convert `missing-records.json` into JSON.

3. **Upload UUIDs**
   - Use `parse` mode to send UUIDs one by one to Worker `/parse`.
   - Sleep ~3s between uploads to respect rate limits.

4. **Check Missing UUIDs**
   - Use `check` mode to verify UUIDs across record tables.
   - Retry missing UUIDs until resolved.

5. **Check Errors**
   - Use `checkErrors` mode to verify UUIDs against error table.
   - Log parser/DB errors for later review.

6. **Compare Old vs. New**
   - Use `compare` mode to deep compare old JSON records with new D1 payloads.
   - Ensures data integrity and consistency.

---

## Local Script Modes

- **parse** → Upload UUIDs to Worker `/parse`.
- **check** → Verify UUIDs across record tables.
- **checkErrors** → Verify UUIDs against error table.
- **extract** → Extract UUIDs from old JSON.
- **sanitizeText** → Convert raw text dump into JSON.
- **sanitize** → Convert `missing-records.json` into JSON.
- **compare** → Deep compare old vs. new records.
- **check / checkErrors** → Verify UUIDs across record and error tables.
- **delete** → Remove records by UUID or map_id.
- **pipeline** → Full cleanup workflow:
  1. Sanitize UUIDs
  2. Check duplicates
  3. Check errors
  4. Pause for inspection
  5. Parse and insert

---

## Sample Data Formats

- **recordsOld.json** → Array of full record objects.
- **uuidsSanitized.json** → `[ { "uuid": "..." }, ... ]`
- **parsed-results.json** → Worker response objects with `summary`, `record`, `upload`.
- **missing-records.json** → `[ "uuid1", "uuid2", ... ]`
- **sbarmyUUIDDump.txt** → Plain text, one UUID per line.

---

## Operational Notes

- **Auditability**  
  Every UUID is tracked in one of the four tables (records, incomplete, no-player, errors).

- **Resilience**  
  Verification endpoints + local scripts ensure no UUID is lost during migration.

- **Transparency**  
  Summaries provide quick feedback for Discord bot and migration logs.


## Map Fix Script

A new local script `mapFix.js` re‑parses affected UUIDs with corrected capsToWin logic.  
Usage:
- Identify UUIDs impacted by changes to the parsing logic.
- Run `mapFix.js` to re‑parse and update rows in `gltp_records`.
- Ensures consistency for maps with `caps_to_win > 1`.

The `mapFix.js` script supports two modes:

- **delete** → Fetches all records for a target `map_id` and generates a SQL DELETE statement.  
  Useful for removing mis‑parsed maps before re‑upload.

- **compare** → Iterates through all records, re‑parses each UUID via the Vercel parser, and compares key fields (`map_name`, `map_id`, `players`, `caps_to_win`, etc.).  
  Differences are logged in batches of 100 and summarized at the end.

This tool is used during cleanup of legacy records affected by capsToWin attribution bugs.

