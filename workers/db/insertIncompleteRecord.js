// db/insertIncompleteRecord.js
export async function insertIncompleteRecord(db, record) {
    const stmt = db.prepare("INSERT INTO gltp_incomplete_records (uuid, payload) VALUES (?, ?)");
    await stmt.bind(record.uuid, JSON.stringify(record)).run();
  }
  