import fetch from "node-fetch";
import { parse } from "csv-parse/sync";

import fs from "fs";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQwuD4GnoZu55o7Uzyrb6jfGID1fGSyq5rxVnVZBbO8661MJOsNKUqusHlwn2QUn5SQDXl-COA86PtE/pub?gid=1775606307&single=true&output=csv";
const recordsFile = "records1.json";
const outputFile = "badmaps.json";

async function main() {
  // Fetch spreadsheet CSV
  const res = await fetch(SHEET_URL);
  const csvText = await res.text();
  const rows = parse(csvText, { columns: true, skip_empty_lines: true });

  // Collect valid IDs
  const validIds = new Set();
  rows.forEach(row => {
    if (row["Map ID"]) validIds.add(row["Map ID"].trim());
    if (row["Pseudo \nMap ID"]) {
      row["Pseudo \nMap ID"]
        .split(",")
        .map(id => id.trim())
        .filter(Boolean)
        .forEach(id => validIds.add(id));
    }
  });

  // Load replay records
  const records = JSON.parse(fs.readFileSync(recordsFile, "utf8"));

  // Collect missing UUIDs
  const missing = records
    .filter(r => !validIds.has(String(r.map_id)) && !validIds.has(String(r.actual_map_id)))
    .map(r => {
      console.log(`❌ Missing map: ${r.map_name} (uuid: ${r.uuid}, map_id: ${r.map_id})`);
      return r.uuid;
    });

  fs.writeFileSync(outputFile, JSON.stringify(missing, null, 2));
  console.log(`✅ Found ${missing.length} missing maps. UUIDs saved to ${outputFile}`);
}

main().catch(err => console.error(err));