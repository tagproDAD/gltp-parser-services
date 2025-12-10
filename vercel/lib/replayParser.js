import { fetchMaps } from "./spreadsheet.js";
import { extractUUID } from "./validation.js";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

//TODO move to env
const isLocal = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseBool(val) {
  if (val === true || val === false) return val;
  if (val == null) return false;
  const s = String(val).trim().toLowerCase();
  return s === "true" || s === "1";
}

export async function fetchReplayLocal(uuid) {
  // Go up two levels: from vercel/lib → project-root
  const baseDir = path.resolve(__dirname, "../../downloadedReplays", uuid);
  const replayPath = path.join(baseDir, "replay.json");
  const metaPath = path.join(baseDir, "metadata.json");

  // 1. If already cached, load from disk
  if (fs.existsSync(replayPath) && fs.existsSync(metaPath)) {
    const text = fs.readFileSync(replayPath, "utf8");
    return text.trim().split("\n").map(line => JSON.parse(line));
  }

  console.log('have to fetch ', uuid);
  // 2. Fetch metadata
  const metaRes = await fetch(`https://tagpro.koalabeast.com/replays/data?uuid=${uuid}`);
  if (!metaRes.ok) throw new Error("Failed to fetch metadata");
  const metadata = await metaRes.json();
  if (!metadata.games || metadata.games.length !== 1) {
    throw new Error("Unexpected replay format");
  }

  const gameId = metadata.games[0].id;
  const mapId = metadata.games[0].mapId; // useful for later reorg

  // 3. Fetch replay data
  const replayRes = await fetch(`https://tagpro.koalabeast.com/replays/gameFile?gameId=${gameId}`);
  if (!replayRes.ok) throw new Error("Failed to fetch replay data");
  const text = await replayRes.text();

  // 4. Save locally
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(replayPath, text);
  fs.writeFileSync(metaPath, JSON.stringify({ uuid, gameId, mapId, ...metadata }, null, 2));

  // 5. Parse and return
  return text.trim().split("\n").map(line => JSON.parse(line));
}

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
  let replay;
  if (isLocal) {
    replay = await fetchReplayLocal(uuid);
  } else {
    replay = await fetchReplay(uuid);
  }
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

    // Stable identity: sessionId -> { sessionId, name, user_id }
  const playersBySession = new Map();

  // Seed from metadata by displayName/userId; enrich from p-packets when sessionId appears
  for (const player of metadata.players) {
    // If metadata includes sessionId, use it directly
    if (player.sessionId) {
      playersBySession.set(player.sessionId, {
        sessionId: player.sessionId,
        name: player.displayName,
        user_id: player.userId,
      });
    }
  }

  // Live mappings: ephemeral id -> sessionId, and team per sessionId
  const idToSession = new Map();   // ephemeral id -> sessionId
  const sessionTeam = new Map();   // sessionId -> 1 (red) or 2 (blue)

  // Ensure mappings and team from a single player entry in a "p" packet
  function ensureSessionFromPacket(pd) {
    // Prefer sessionId, but fall back to ephemeral id
    const sid = pd.sessionId || `eid:${pd.id}`;
    idToSession.set(pd.id, sid);

    // Look up metadata entry once
    const meta = metadata.players.find(m => m.id === pd.id);

    let p = playersBySession.get(sid);
    if (!p) {
      playersBySession.set(sid, {
        sessionId: sid,
        name: pd.name ?? meta?.displayName ?? `Player${pd.id}`,
        user_id: meta?.userId ?? null,
      });
    } else {
      p.name = pd.name ?? p.name;
    }

    // Set team from packet or metadata
    if (typeof pd.team === "number") {
      sessionTeam.set(sid, pd.team);
    } else if (meta?.team !== undefined) {
      sessionTeam.set(sid, meta.team);
    }

    return sid;
  }

  function detectCapture(replay, {
      teamCapsMode,
      allowBlueCaps,
      capsToWin,
      firstTimerTs,
      playersBySession,
      idToSession,
      sessionTeam
    }) {
      const lastCapturesBySession = new Map();

      let recordTime = null;
      let cappingUserName = null;
      let cappingUserId = null;
      let cappingPlayerQuote = null;
      let total_jumps = 0;

      let redCaps = 0;
      let blueCaps = 0;

      let lastScoreR = 0;
      let lastScoreB = 0;
      let lastScoreEventTsR = null;
      let lastScoreEventTsB = null;
      let lastTeamCapEvent = null;

      if (capsToWin === -1) {
        return {
          recordTime: null,
          cappingUserName: null,
          cappingUserId: null,
          cappingPlayerQuote: null,
          totalJumps: null,
        };
      }

      for (const [ts, type, data] of replay) {
        // Track score changes
        if (type === "score") {
          if (data.r > lastScoreR) {
            lastTeamCapEvent = { ts, team: 1 };
            lastScoreEventTsR = ts; // red scored
          }
          if (data.b > lastScoreB) {
            lastTeamCapEvent = { ts, team: 2 };
            lastScoreEventTsB = ts; // blue scored
          }
          lastScoreR = data.r;
          lastScoreB = data.b;
          continue;
        } else if (type !== "p") {
          continue;
        }

        for (const pd of data) {
          const sid = ensureSessionFromPacket(pd);
          if (!sid) continue;

          const teamNow = sessionTeam.get(sid);
          const captures = pd["s-captures"] || 0;

          const prev = lastCapturesBySession.get(sid) || 0;
          const delta = captures - prev;
          lastCapturesBySession.set(sid, captures);

          // Respect allowBlueCaps
          if (teamNow === 2 && !allowBlueCaps) continue;

          if (delta <= 0) continue;

          if (teamCapsMode) {
            // Team mode: accumulate per side
            if (teamNow === 1 && lastScoreEventTsR && ts >= lastScoreEventTsR) {
              redCaps += delta;
              if (redCaps >= capsToWin && recordTime === null) {
                recordTime = ts - firstTimerTs;
                const p = playersBySession.get(sid);
                cappingUserName = p?.name ?? null;
                cappingUserId = p?.user_id ?? null;
              }
            } else if (teamNow === 2 && allowBlueCaps && lastScoreEventTsB && ts >= lastScoreEventTsB) {
              blueCaps += delta;
              if (blueCaps >= capsToWin && recordTime === null) {
                recordTime = ts - firstTimerTs;
                const p = playersBySession.get(sid);
                cappingUserName = p?.name ?? null;
                cappingUserId = p?.user_id ?? null;
              }
            }
          } else {
            // Non-team mode: any valid delta counts
            if (delta < capsToWin) continue;
            // Require a score event for either red or blue
            if (
              !(
                (lastScoreEventTsR && ts >= lastScoreEventTsR) ||
                (lastScoreEventTsB && ts >= lastScoreEventTsB && allowBlueCaps)
              )
            ) {
              continue;
            }

            recordTime = ts - firstTimerTs;
            const p = playersBySession.get(sid);
            cappingUserName = p?.name ?? null;
            cappingUserId = p?.user_id ?? null;
          }

          if (recordTime !== null) {
            // Count jumps until this timestamp
            total_jumps = replay.reduce((count, r) => {
              const [ts2, type2, data2] = r;
              if (
                ts2 <= ts &&
                type2 === "replayPlayerMessage" &&
                data2?.type === "sound" &&
                data2?.data?.s === "jump"
              ) {
                return count + 1;
              }
              return count;
            }, 0);

            // Most recent chat from decisive player
            const playerChats = replay.filter(
              r => r[1] === "chat" && idToSession.get(r[2].from) === sid
            );
            cappingPlayerQuote = playerChats.length
              ? playerChats[playerChats.length - 1][2].message
              : null;

            break;
          }
        }
        if (recordTime !== null) break;
      }

      return {
        recordTime,
        cappingUserName,
        cappingUserId,
        cappingPlayerQuote,
        total_jumps
      };
    }

  const firstTimerTs =
    replay.find(r => r[1] === "time" && r[2]?.state === 1)?.[0] ?? 0;

  // ---------------------------
  // CAPS TO WIN FIX
  // ---------------------------
  let capsToWin = 1;
  let effectiveMapId = actualMapId;
  let allowBlueCaps = false;
  let teamCapsMode = false;

  if (matchedMap) {
    if (matchedMap.caps_to_win === "pups") {
      capsToWin = "-1"; // FIXED — Infinity cannot be matched
    } else {
      capsToWin = parseInt(matchedMap.caps_to_win || "1", 10);
    }
    effectiveMapId = matchedMap.map_id;
    allowBlueCaps = parseBool(matchedMap.allow_blue_caps);
    teamCapsMode = parseBool(matchedMap.team_caps);
  }

  // ---------------------------
  // CAPTURE DETECTION
  // ---------------------------
    const {
    recordTime,
    cappingUserName,
    cappingUserId,
    cappingPlayerQuote,
    total_jumps
  } = detectCapture(replay, {
    teamCapsMode,
    allowBlueCaps,
    capsToWin,
    firstTimerTs,
    playersBySession,
    idToSession,
    sessionTeam
  });


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