// db/insertNoPlayerRecord.js
export async function insertNoPlayerRecord(db, record) {
    const stmt = db.prepare("INSERT INTO gltp_no_player_records (uuid, payload) VALUES (?, ?)");
    await stmt.bind(record.uuid, JSON.stringify(record)).run();
  }
  