import { fetchMaps } from "./spreadsheet.js";
import { extractUUID } from "./validation.js";

export async function fetchReplay(uuid) {
  const metaRes = await fetch(`https://tagpro.koalabeast.com/replays/data?uuid=${uuid}`);
  if (!metaRes.ok) throw new Error("Failed to fetch metadata");
  const metadata = await metaRes.json();
  if (!metadata.games || metadata.games.length !== 1) {
    throw new Error("Unexpected replay format");
  }

  const gameId = metadata.games[0].id;
  const replayRes = await fetch(`https://tagpro.koalabeast.com/replays/gameFile?gameId=${gameId}`);
  if (!replayRes.ok) throw new Error("Failed to fetch replay data");

  const text = await replayRes.text();
  return text.trim().split("\n").map(line => JSON.parse(line));
}

export async function parseReplayFromUUID(uuidLink) {
  const uuid = extractUUID(uuidLink) || uuidLink;
  const replay = await fetchReplay(uuid);
  const maps = await fetchMaps();
  return getDetails(replay, maps);
}

export async function parseReplayFromReplayLink(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch replay data");
  const text = await res.text();
  const lines = text.trim().split("\n").map(line => JSON.parse(line));
  const maps = await fetchMaps();
  return getDetails(lines, maps);
}

// ---------------------------
// MAP MATCHING FIX
// ---------------------------
function resolveMap(mapId, maps) {
  if (!mapId) return null;

  // Try direct match
  let matched = maps.find(m => String(m.map_id) === String(mapId));
  if (matched) return matched;

  // Try equivalent IDs (fixed strict string compare)
  return maps.find(m =>
    m.equivalent_map_ids?.some(id => String(id) === String(mapId)) // FIXED
  );
}

// ---------------------------
// CORE PARSER
// ---------------------------
function getDetails(replay, maps) {
  if (
    replay[0][1] !== "recorder-metadata" ||
    replay[2][1] !== "map" ||
    replay[3][1] !== "clientInfo"
  ) {
    throw new Error("Invalid replay format");
  }

  const metadata = replay[0][2];
  const mapData = replay[2][2];
  const mapfile = replay[3][2]?.mapfile;
  const actualMapId = mapfile ? mapfile.split("/")[1] : null;

  const matchedMap = resolveMap(actualMapId, maps);
  console.log("before check");
  console.log(matchedMap);
  if (!matchedMap) {
    throw new Error(`Map with ID ${actualMapId} not found in spreadsheet`);
  }

  const players = {};
  metadata.players.forEach(player => {
    players[player.id] = {
      name: player.displayName,
      user_id: player.userId,
      is_red: player.team === 1,
    };
  });

  const firstTimerTs =
    replay.find(r => r[1] === "time" && r[2]?.state === 1)?.[0] ?? 0;

  let recordTime = null;
  let cappingUserName = null;
  let cappingUserId = null;
  let cappingPlayerQuote = null;
  let total_jumps = 0;

  // ---------------------------
  // CAPS TO WIN FIX
  // ---------------------------
  let capsToWin = 1;
  let effectiveMapId = actualMapId;
  let allowBlueCaps = false;

  if (matchedMap) {
    if (matchedMap.caps_to_win === "pups") {
      capsToWin = null; // FIXED — Infinity cannot be matched
    } else {
      capsToWin = parseInt(matchedMap.caps_to_win || "1", 10);
    }
    effectiveMapId = matchedMap.map_id;
    allowBlueCaps = Boolean(matchedMap.allow_blue_caps);
  }

  // ---------------------------
  // CAPTURE DETECTION FIX
  // ---------------------------
  for (const [ts, type, data] of replay) {
    if (type !== "p") continue;

    for (const playerData of data) {
      const captures = playerData["s-captures"];
      const cappingPlayer = players[playerData.id];
      if (!cappingPlayer) continue;

      // Check team rules (FIXED)
      if (!cappingPlayer.is_red && !allowBlueCaps) {
        continue;
      }

      // Check capture count (FIXED pup logic)
      if (capsToWin !== null && captures !== capsToWin) {
        continue;
      }

      // CAP CONFIRMED
      recordTime = ts - firstTimerTs;
      cappingUserName = cappingPlayer.name;
      cappingUserId = cappingPlayer.user_id;

      // Count jumps until this timestamp
      const capTimestamp = ts;
      total_jumps = replay.reduce((count, r) => {
        const [ts2, type2, data2] = r;
        if (
          ts2 <= capTimestamp &&
          type2 === "replayPlayerMessage" &&
          data2?.type === "sound" &&
          data2?.data?.s === "jump"
        ) {
          return count + 1;
        }
        return count;
      }, 0);

      // Get most recent chat
      const playerChats = replay.filter(
        r => r[1] === "chat" && r[2].from === playerData.id
      );
      cappingPlayerQuote = playerChats.length
        ? playerChats[playerChats.length - 1][2].message
        : null;

      break;
    }
    if (recordTime !== null) break;
  }

  return {
    map_name: mapData.info.name,
    map_id: effectiveMapId,
    actual_map_id: actualMapId,
    map_author: mapData.info.author,
    players: Object.values(players),
    capping_player: cappingUserName,
    capping_player_user_id: cappingUserId,
    record_time: recordTime,
    is_solo: Object.keys(players).length === 1,
    timestamp: metadata.started,
    uuid: metadata.uuid,
    capping_player_quote: cappingPlayerQuote,
    caps_to_win: capsToWin,
    allow_blue_caps: allowBlueCaps,
    total_jumps,
  };
}