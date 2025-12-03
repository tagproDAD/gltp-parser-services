// db/insertError.js
export async function insertError(db, uuid, errorMessage) {
    // Validate UUID format (basic RFC4122 v4 regex)
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const safeUuid = (typeof uuid === "string" && regex.test(uuid)) ? uuid : null;
  
    // Always cast errorMessage to string (controlled by you, not user input)
    const safeMessage = String(errorMessage);
  
    // Use INSERT OR IGNORE to avoid duplicate UUIDs in error log
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO gltp_errors (uuid, error_message) VALUES (?, ?)"
    );
    await stmt.bind(safeUuid, safeMessage).run();
  }
  