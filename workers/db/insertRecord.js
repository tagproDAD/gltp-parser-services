// src/db/insertRecord.js
export async function insertRecord(DB, record) {
  // Store entire record as JSON string
  const payload = JSON.stringify(record);

  // Prepared insert with new columns
  const stmt = DB.prepare(`
    INSERT INTO gltp_records (
      uuid,
      payload,
      capping_player,
      map_id,
      record_time,
      map_name,
      map_author,
      total_jumps
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  await stmt.bind(
    record.uuid,
    payload,
    record.capping_player ?? null,
    record.map_id ?? null,
    record.record_time ?? null,
    record.map_name ?? null,
    record.map_author ?? null,
    record.total_jumps ?? null
  ).run();
}
