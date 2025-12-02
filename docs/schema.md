# Schema

## Overview
The GLTP backend uses a Cloudflare D1 database to store all replay outcomes.  
Data is organized into four tables so every UUID is tracked: completed runs, incomplete runs, no‑player runs, and errors.  
Payloads are stored as JSON strings for flexibility, and UUID uniqueness ensures clean reconciliation.

---

## Tables

### gltp_records
Purpose: Completed runs (primary dataset).  
Columns:
- uuid (PRIMARY KEY)
- payload (TEXT, JSON string)
- inserted_at (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)  
Notes:
- Duplicate UUIDs are rejected.
- Insert performed via a prepared statement.

### gltp_incomplete_records
Purpose: Runs with players present but no valid cap.  
Columns:
- uuid (PRIMARY KEY)
- payload (TEXT, JSON string)
- inserted_at (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)  
Notes:
- Used for analytics and debugging incomplete attempts.

### gltp_no_player_records
Purpose: Runs with zero players.  
Columns:
- uuid (PRIMARY KEY)
- payload (TEXT, JSON string)
- inserted_at (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)  
Notes:
- Useful for filtering empty games and retaining UUIDs.

### gltp_errors
Purpose: Parser/DB errors tied to UUIDs.  
Columns:
- rowid (INTEGER PRIMARY KEY AUTOINCREMENT)
- uuid (TEXT, may be NULL if invalid)
- error_message (TEXT)
- inserted_at (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)  
Notes:
- Insert uses INSERT OR IGNORE to avoid duplicate UUID rows.
- Error messages are always cast to strings for consistency.

---

## Suggested D1 schema (SQL)

-- Completed runs
CREATE TABLE IF NOT EXISTS gltp_records (
  uuid TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Incomplete runs
CREATE TABLE IF NOT EXISTS gltp_incomplete_records (
  uuid TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- No-player runs
CREATE TABLE IF NOT EXISTS gltp_no_player_records (
  uuid TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Errors
CREATE TABLE IF NOT EXISTS gltp_errors (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT,
  error_message TEXT NOT NULL,
  inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(uuid)
);

---

## Payload Format

All record payloads are stored as JSON strings in the payload column.  
This preserves full replay metadata without schema fragmentation.

Example payload:
{
  "map_name": "Potato Sack Race (2v2) (Official FWO)",
  "map_id": "82692",
  "actual_map_id": "82692",
  "map_author": "Carey Price",
  "players": [
    { "name": "ibex", "user_id": null, "is_red": true },
    { "name": "porcupine", "user_id": null, "is_red": true }
  ],
  "capping_player": "ibex",
  "capping_player_user_id": null,
  "record_time": 1841236,
  "is_solo": false,
  "timestamp": 1764541422779,
  "uuid": "76a503d5-bcad-4d08-9464-e20847c22db4",
  "capping_player_quote": null,
  "caps_to_win": 1,
  "allow_blue_caps": false,
  "total_jumps": 2104,
  "origin": "discord",
  "timestamp_uploaded": 1764552812612
}

---

## Summary Fields

For lightweight responses, records are reduced to summaries using formatShortSummary:

- uuid
- map_name
- player (capping player)
- time (formatted M:SS.mmm)

Example summary:
{
  "uuid": "76a503d5-bcad-4d08-9464-e20847c22db4",
  "map_name": "Potato Sack Race (2v2) (Official FWO)",
  "player": "ibex",
  "time": "30:41.236"
}

---

## Design Notes

- UUID uniqueness prevents duplicates and simplifies reconciliation across tables.
- JSON payloads preserve full replay data and make schema changes easy.
- Error visibility: all failures captured with messages; malformed UUIDs allowed as NULL.
- Operational clarity: separate tables reflect distinct outcomes (completed, incomplete, no-player, error), aiding analytics and audits.
- Summaries provide quick feedback for Discord bot replies and migration logs.
