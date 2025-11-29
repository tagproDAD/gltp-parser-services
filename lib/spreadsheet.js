// lib/spreadsheet.js

let cache = null;
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const SHEET_URL = process.env.SPREADSHEET_URL; 
// set this in Vercel project settings → Environment Variables

export async function getMapConfig(mapId) {
  const configs = await fetchSpreadsheet();
  return configs[mapId] || null;
}

async function fetchSpreadsheet() {
  const now = Date.now();
  if (cache && now - lastFetch < CACHE_TTL) {
    return cache;
  }

  const res = await fetch(SHEET_URL);
  if (!res.ok) throw new Error("Failed to fetch spreadsheet");
  const text = await res.text();

  // Parse CSV rows into config objects
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");
  const configs = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const row = Object.fromEntries(headers.map((h, idx) => [h.trim(), cols[idx]?.trim()]));
    configs[row.map_id] = {
      caps_to_win: Number(row.caps_to_win || 1),
      allow_blue_caps: row.allow_blue_caps === "true",
    };
  }

  cache = configs;
  lastFetch = now;
  return configs;
}
