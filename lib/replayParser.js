import { fetchMaps } from "./spreadsheet.js";
import { extractUUID } from "./validation.js";

export async function fetchReplay(uuid) {
  const metaRes = await fetch(`https://tagpro.koalabeast.com/replays/data?uuid=${uuid}`);
  if (!metaRes.ok) throw new Error("Failed to fetch metadata");
  const metadata = await metaRes.json();
  if (!metadata.games || metadata.games.length !== 1) throw new Error("Unexpected replay format");

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

function resolveMap(mapId, maps) {
  // Try direct match
  let matched = maps.find(m => m.map_id === mapId);
  if (matched) return matched;

  // Try pseudo match
  return maps.find(m => m.equivalent_map_ids.includes(mapId));
}

// Core parser logic (ported from your bot)
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
  const matchedMap = actualMapId ? resolveMap(String(actualMapId), maps) : null;

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

  // Default values
  let capsToWin = 1;
  let effectiveMapId = actualMapId;
  let allowBlueCaps = false;

  if (matchedMap) {
    if (matchedMap.caps_to_win === "pups") {
      capsToWin = Infinity;
    } else {
      capsToWin = parseInt(matchedMap.caps_to_win || "1", 10);
    }
    effectiveMapId = matchedMap.map_id;
    allowBlueCaps = matchedMap.allow_blue_caps;
  }

  for (const [ts, type, data] of replay) {
    if (type !== "p") continue;

    for (const playerData of data) {
      const captures = playerData["s-captures"];
      if (captures !== capsToWin) continue;

      const cappingPlayer = players[playerData.id];
      if (!cappingPlayer) continue;

      recordTime = ts - firstTimerTs;
      cappingUserName = cappingPlayer.name;
      cappingUserId = cappingPlayer.user_id;

      if (recordTime !== null && cappingUserName) {
        const capTimestamp = firstTimerTs + recordTime;
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
      }

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
    map_id: effectiveMapId,       // canonical spreadsheet ID
    actual_map_id: actualMapId,   // raw replay ID
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
    allow_blue_caps: matchedMap ? matchedMap.allow_blue_caps : false,
    total_jumps,
  };
}
