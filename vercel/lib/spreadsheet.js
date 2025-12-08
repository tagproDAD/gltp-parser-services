let cache = null;
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

//make this a environment variable
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQwuD4GnoZu55o7Uzyrb6jfGID1fGSyq5rxVnVZBbO8661MJOsNKUqusHlwn2QUn5SQDXl-COA86PtE/pub?gid=1775606307&single=true&output=csv";

export async function fetchMaps() {
  const now = Date.now();
  if (cache && now - lastFetch < CACHE_TTL) return cache;
  const res = await fetch(SHEET_URL);
  if (!res.ok) throw new Error("Failed to fetch map data");
  const csvText = await res.text();

  const rows = parseCSV(csvText);
  const headers = rows.shift().map(h => h.trim());

  const get = (row, header) => {
    const index = headers.findIndex(h => h === header);
    return index !== -1 ? row[index]?.trim() || "" : "";
  };

  const allMaps = rows
    .map(row => ({
      name: get(row, "Map / Player"),
      preset: get(row, "Group Preset"),
      difficulty: get(row, "Final Rating"),
      fun: get(row, "Final Fun \nRating"),
      category: get(row, "Category"),
      map_id: get(row, "Map ID"),
      equivalent_map_ids: get(row, "Pseudo \nMap ID").split(",").map(id => id.trim()).filter(Boolean),
      caps_to_win: get(row, "Num\nof caps"),
      team_caps: get(row, "Team\nCaps"),
      allow_blue_caps: get(row, "Allow Blue Caps").toUpperCase() === "TRUE",
      balls_req: get(row, "Min\nBalls \nRec"),
      max_balls_rec: get(row, "Max\nBalls\nRec"),
    }))
    .filter(m => m.preset && m.preset.trim());

  cache = allMaps;
  lastFetch = now;
  return allMaps;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"'; i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field); field = "";
      } else if (char === "\n") {
        row.push(field); rows.push(row); row = []; field = "";
      } else if (char === "\r") {
        continue;
      } else {
        field += char;
      }
    }
  }
  if (field || row.length) {
    row.push(field); rows.push(row);
  }
  return rows;
}
