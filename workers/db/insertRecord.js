// src/db/insertRecord.js
export async function insertRecord(DB, record) {
    // Store entire record as JSON string
    const payload = JSON.stringify(record);
  
    // Prepared insert - will throw on duplicate (PRIMARY KEY)
    const stmt = DB.prepare("INSERT INTO gltp_records (uuid, payload) VALUES (?, ?)");
    await stmt.bind(record.uuid, payload).run();
  }
  