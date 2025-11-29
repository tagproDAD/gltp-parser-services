// lib/validation.js

// Utility: extract UUID from a string
export function extractUUID(input) {
  const uuidRegex =
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  const match = input.match(uuidRegex);
  return match ? match[0] : null;
}

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
