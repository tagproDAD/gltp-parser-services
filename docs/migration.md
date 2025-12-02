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
