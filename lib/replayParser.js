import { getMapConfig } from "./spreadsheet.js";

export async function parseReplayFromUUID(uuid) {
  // Step 1: metadata
  const metaRes = await fetch(`https://tagpro.koalabeast.com/replays/data?uuid=${uuid}`);
  if (!metaRes.ok) throw new Error("Failed to fetch metadata");
  const metadata = await metaRes.json();
  if (!metadata.games || metadata.games.length !== 1) throw new Error("Unexpected replay format");

  // Step 2: replay file
  const gameId = metadata.games[0].id;
  const replayRes = await fetch(`https://tagpro.koalabeast.com/replays/gameFile?gameId=${gameId}`);
  if (!replayRes.ok) throw new Error("Failed to fetch replay data");

  const text = await replayRes.text();
  const lines = text.trim().split("\n").map(line => JSON.parse(line));

  // Step 3: parse into record
  const record = buildRecord(uuid, gameId, lines);
  return record;
}

function buildRecord(uuid, gameId, lines) {
  // Example: count jumps
  const totalJumps = lines.filter(ev => ev.type === "jump").length;

  // Example: extract cap event
  const capEvent = lines.find(ev => ev.type === "cap");
  if (!capEvent) return null;

  const mapConfig = getMapConfig(capEvent.map_id);

  return {
    uuid,
    gameId,
    map_id: capEvent.map_id,
    actual_map_id: capEvent.map_id,
    map_name: capEvent.map_name,
    map_author: capEvent.map_author,
    players: capEvent.players,
    capping_player: capEvent.player,
    capping_player_user_id: capEvent.user_id,
    record_time: capEvent.time,
    is_solo: capEvent.is_solo,
    timestamp: Date.now(),
    caps_to_win: mapConfig?.caps_to_win || 1,
    total_jumps: totalJumps,
  };
}
