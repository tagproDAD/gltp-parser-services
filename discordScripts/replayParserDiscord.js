// Utility: split string from the right
if (!String.prototype.rsplit) {
  String.prototype.rsplit = function (sep, maxsplit) {
    const split = this.split(sep);
    return maxsplit
      ? [split.slice(0, -maxsplit).join(sep)].concat(split.slice(-maxsplit))
      : split;
  };
}

function extractUUID(input) {
  const uuidRegex =
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  const match = input.match(uuidRegex);
  return match ? match[0] : null;
}

// Fetch replay lines from TagPro by UUID
async function fetchReplay(uuid) {
  const metadataResponse = await fetch(
    `https://tagpro.koalabeast.com/replays/data?uuid=${uuid}`
  );
  if (!metadataResponse.ok)
    throw new Error("Failed to fetch metadata, make sure you're using the UUID");

  const metadata = await metadataResponse.json();
  if (!metadata.games || metadata.games.length !== 1) {
    throw new Error("Unexpected replay format");
  }

  const gameId = metadata.games[0].id;
  const gameResponse = await fetch(
    `https://tagpro.koalabeast.com/replays/gameFile?gameId=${gameId}`
  );
  if (!gameResponse.ok) throw new Error("Failed to fetch replay data");

  const text = await gameResponse.text();
  const lines = text.trim().split("\n").map((line) => JSON.parse(line));
  return lines;
}

function formatMilliseconds(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = (milliseconds % 60000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

// Fetch and parse maps spreadsheet
async function fetchMaps() {
  const response = await fetch(
    "https://docs.google.com/spreadsheets/d/1OnuTCekHKCD91W39jXBG4uveTCCyMxf9Ofead43MMCU/export?format=csv&gid=1775606307"
  );
  if (!response.ok) throw new Error("Failed to fetch map data");

  const csvText = await response.text();

  function parseCSV(text) {
    const rows = [];
    let row = [],
      field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i],
        next = text[i + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          field += '"';
          i++; // Escaped quote
        } else if (char === '"') {
          inQuotes = false;
        } else {
          field += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ",") {
          row.push(field);
          field = "";
        } else if (char === "\n") {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
        } else if (char === "\r") {
          continue;
        } else {
          field += char;
        }
      }
    }
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  const rows = parseCSV(csvText);
  const headers = rows.shift().map((h) => h.trim());

  const get = (row, header) => {
    const index = headers.findIndex((h) => h === header);
    return index !== -1 ? row[index]?.trim() || "" : "";
  };

  const allMaps = rows
    .map((row) => ({
      name: get(row, "Map / Player"),
      preset: get(row, "Group Preset"),
      difficulty: get(row, "Final Rating"),
      fun: get(row, "Final Fun \nRating"),
      category: get(row, "Category"),
      map_id: get(row, "Map ID"),
      equivalent_map_ids: get(row, "Pseudo \nMap ID").split(","),
      caps_to_win: get(row, "Num\nof caps"),
      allow_blue_caps: get(row, "Allow Blue Caps").toUpperCase() === "TRUE",
      balls_req: get(row, "Min\nBalls \nRec"),
      max_balls_rec: get(row, "Max\nBalls\nRec"),
    }))
    .filter((m) => m.preset && m.preset.trim());

  return allMaps;
}

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
  const mapId = mapfile ? mapfile.split("/")[1] : null;

  const players = {};
  metadata.players.forEach((player) => {
    players[player.id] = {
      name: player.displayName,
      user_id: player.userId,
      is_red: player.team === 1,
    };
  });

  const firstTimerTs =
    replay.find((r) => r[1] === "time" && r[2]?.state === 1)?.[0] ?? 0;

  let recordTime = null;
  let cappingUserName = null;
  let cappingUserId = null;
  let cappingPlayerQuote = null;
  let total_jumps = 0;

  let matchedMap = maps.find((m) => m.map_id === mapId);
  if (!matchedMap) {
    matchedMap = maps.find((m) =>
      m.equivalent_map_ids.includes(String(mapId))
    );
  }

  let capsToWin = 1;
  if (matchedMap) {
    const capsRaw = matchedMap.caps_to_win;
    capsToWin = capsRaw === "pups" ? Infinity : parseInt(capsRaw || "1", 10);
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
          const [ts, type, data] = r;
          if (
            ts <= capTimestamp &&
            type === "replayPlayerMessage" &&
            data?.type === "sound" &&
            data?.data?.s === "jump"
          ) {
            return count + 1;
          }
          return count;
        }, 0);
      }

      const playerChats = replay.filter(
        (r) => r[1] === "chat" && r[2].from === playerData.id
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
    map_id: matchedMap.map_id,
    actual_map_id: mapId,
    map_author: mapData.info.author,
    players: Object.values(players),
    capping_player: cappingUserName,
    capping_player_user_id: cappingUserId,
    record_time: recordTime !== null ? recordTime : null,
    is_solo: Object.keys(players).length === 1,
    timestamp: metadata.started,
    uuid: metadata.uuid,
    capping_player_quote: cappingPlayerQuote,
    caps_to_win: capsToWin,
    allow_blue_caps: matchedMap ? matchedMap.allow_blue_caps : false,
    total_jumps: total_jumps,
  };
}

// Parse replay from UUID
async function parseReplayFromUUID(uuidLink) {
  const uuid = extractUUID(uuidLink) || uuidLink;
  const replay = await fetchReplay(uuid);
  const maps = await fetchMaps();
  return getDetails(replay, maps);
}

// Parse replay from replay link
async function parseReplayFromReplayLink(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch replay data");
  const text = await response.text();
  const lines = text.trim().split("\n").map((line) => JSON.parse(line));
  const maps = await fetchMaps();
  return getDetails(lines, maps);
}

export { parseReplayFromUUID, parseReplayFromReplayLink, fetchMaps, getDetails };
