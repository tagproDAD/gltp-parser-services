// lib/validation.js

// Detect whether input is a replay link or UUID
export function validateInput(input) {
  const validPrefix = "https://tagpro.koalabeast.com/";
  if (input.startsWith(validPrefix)) {
    if (input.includes("replay=")) return "replay";
    if (input.includes("uuid=")) return "uuid";
  }
  const uuidRegex = /^[0-9a-f-]{36}$/i;
  if (uuidRegex.test(input)) return "uuid";
  return "invalid";
}

// Normalize replay URLs (convert ?replay= links into gameFile URLs)
export function normalizeReplayUrl(url) {
  if (url.includes("game?replay=")) {
    const id = new URL(url).searchParams.get("replay");
    return `https://tagpro.koalabeast.com/replays/gameFile?key=${id}`;
  }
  return url;
}

// Validate a parsed record against spreadsheet rules
import { getMapConfig } from "./spreadsheet.js";

export function validateCap(record) {
  const mapConfig = getMapConfig(record.map_id);
  if (!mapConfig) return false;

  // Enforce caps_to_win
  if (record.caps_to_win !== mapConfig.caps_to_win) return false;

  // Enforce blue cap restrictions
  if (!mapConfig.allow_blue_caps && record.capping_player && !record.capping_player.is_red) {
    return false;
  }

  return true;
}
