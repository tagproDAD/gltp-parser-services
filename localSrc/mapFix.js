import fetch from "node-fetch";
import fs from "fs";

const CLOUDFLARE_URL = "https://gltp.fwotagprodad.workers.dev/records";
const VERCEL_PARSE_URL = "http://localhost:3000/api/parse"; // replace with your actual endpoint

// Entry point
const mode = process.argv[2];
if (mode === "delete") {
  runDelete();
} else if (mode ==="compare") {
  main();
} else {
  console.log("Usage: node script.js [delete||compare]");
}

// Helper: sleep for ms milliseconds
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDelete() {
  const targetMapId = "86870";
  if (!targetMapId) {
    console.error("❌ Please provide a map_id");
    return;
  }

  try {
    const res = await fetch(CLOUDFLARE_URL);
    const records = await res.json();

    // Filter records by map_id
    const uuids = records
      .filter(r => r.map_id === targetMapId)
      .map(r => r.uuid);

    if (uuids.length === 0) {
      console.log(`No records found for map_id ${targetMapId}`);
      return;
    }
    console.log("found this map uuids: ", uuids.length)

    // Build SQL DELETE query
    const placeholders = uuids.map(u => `'${u}'`).join(", ");
    const sql = `DELETE FROM gltp_records WHERE uuid IN (${placeholders});`;

    console.log("\n=== Generated SQLite DELETE Query ===");
    console.log(sql);

    // Build JSON array
    const jsonArray = uuids.map(u => ({ uuid: u }));

    // Write to file
    const filename = `delete_${targetMapId}.json`;
    fs.writeFileSync(filename, JSON.stringify(jsonArray, null, 2));

    console.log(`\n=== UUIDs written to ${filename} ===`);
  } catch (err) {
    console.error("❌ Failed to fetch or process records:", err);
  }
}

async function parseWithVercel(uuid) {
  try {
    const res = await fetch(VERCEL_PARSE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: uuid, origin: "local-test" }),
    });
    const parsed = await res.json();
    if (!parsed.ok) {
      console.log(`❌ Vercel parse error for ${uuid}: ${parsed.error}`);
      return null;
    }
    return parsed.record; // unwrap the record object
  } catch (err) {
    console.error(`❌ Request to Vercel failed for ${uuid}:`, err);
    return null;
  }
}

async function main() {
  const res = await fetch(CLOUDFLARE_URL);
  const records = await res.json();

  const allDiffs = [];
  let batchDiffs = [];

  const fieldsToCheck = [
    "map_name",
    "map_id",
    "actual_map_id",
    "map_author",
    "players",
    "capping_player",
    "capping_player_user_id",
    "record_time",
    "caps_to_win",
    "allow_blue_caps",
    "total_jumps",
  ];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const uuid = record.uuid;
    const parsedRecord = await parseWithVercel(uuid);
    if (!parsedRecord) continue;


    for (const field of fieldsToCheck) {
      const parsedVal = JSON.stringify(parsedRecord[field]);
      const dbVal = JSON.stringify(record[field]);

      // skip if both null/undefined
      if (parsedRecord[field] == null && record[field] == null) continue;

      if (parsedVal !== dbVal) {
        const diff = { uuid, field, parsed: parsedRecord[field], db: record[field] };
        batchDiffs.push(diff);
        allDiffs.push(diff);
      }
    }

    //await sleep(2000);
    // Every 100 records, output batch summary
    if ((i + 1) % 100 === 0) {
      console.log(`\n=== Differences for records ${i - 99} to ${i + 1} ===`);
      if (batchDiffs.length > 0) {
        console.table(batchDiffs);
      } else {
        console.log("NO diff");
      }
      batchDiffs = []; // reset batch
      //await sleep(10000);
    }
  }

  // Final overall summary
  console.log("\n=== Final Overall Summary of Differences ===");
  console.table(allDiffs);

  // Optional: count mismatches per field
  const fieldCounts = allDiffs.reduce((acc, d) => {
    acc[d.field] = (acc[d.field] || 0) + 1;
    return acc;
  }, {});
  console.log("\n=== Mismatch Counts by Field ===");
  console.table(fieldCounts);
}