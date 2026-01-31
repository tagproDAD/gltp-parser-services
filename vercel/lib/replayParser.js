import { fetchMaps } from "./spreadsheet.js";
import { extractUUID } from "./validation.js";

function parseBool(val) {
  if (val === true || val === false) return val;
  if (val == null) return false;
  const s = String(val).trim().toLowerCase();
  return s === "true" || s === "1";
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
  replay = await fetchReplay(uuid);
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

  // Try equivalent IDs
  return maps.find(m =>
    m.equivalent_map_ids?.some(id => String(id) === String(mapId))
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
      p = {
        sessionId: sid,
        name: pd.name ?? meta?.displayName ?? `Player${pd.id}`,
        user_id: meta?.userId ?? null
      };
      playersBySession.set(sid, p);
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
    allowFromSpawn,
    allowFromGrab,
    playersBySession,
    idToSession,
    sessionTeam
  }) {
    const lastCapturesBySession = new Map();
    const runStartTsBySession = new Map(); // per-session run start

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
          lastScoreEventTsR = ts; // red scored
          lastTeamCapEvent = { ts, team: 1 };
        }
        if (data.b > lastScoreB) {
          lastScoreEventTsB = ts; // blue scored
          lastTeamCapEvent = { ts, team: 2 };
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

        // ---------------------------
        // TIMER RESET LOGIC 
        // ---------------------------

        // allow_from_spawn: reset when this player is respawned (directSet with not dead)
        // BUT only after game has started
        if (
          allowFromSpawn &&
          ts >= firstTimerTs &&  // ← Add this check
          pd.directSet === true &&
          pd.dead === false
        ) {
          runStartTsBySession.set(sid, ts);
        }

        // allow_from_grab: reset when this player grabs any flag
        // BUT only after game has started
        if (
          allowFromGrab &&
          ts >= firstTimerTs &&  // ← Add this check
          pd.flag !== null &&
          pd.flag !== undefined &&
          pd.flag > 0
        ) {
          const currentStart = runStartTsBySession.get(sid);
          if (!currentStart || ts > currentStart) {
            runStartTsBySession.set(sid, ts);
          }
        }

        // ---------------------------
        // CAPTURE DETECTION
        // ---------------------------

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
              // Use per-session run start if available, otherwise use game start
              const runStart = runStartTsBySession.get(sid) || firstTimerTs;
              recordTime = ts - runStart;
              const p = playersBySession.get(sid);
              cappingUserName = p?.name ?? null;
              cappingUserId = p?.user_id ?? null;
            }
          } else if (teamNow === 2 && allowBlueCaps && lastScoreEventTsB && ts >= lastScoreEventTsB) {
            blueCaps += delta;
            if (blueCaps >= capsToWin && recordTime === null) {
              const runStart = runStartTsBySession.get(sid) || firstTimerTs;
              recordTime = ts - runStart;
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

          // Use per-session run start if available, otherwise use game start
          const runStart = runStartTsBySession.get(sid) || firstTimerTs;
          recordTime = ts - runStart;
          const p = playersBySession.get(sid);
          cappingUserName = p?.name ?? null;
          cappingUserId = p?.user_id ?? null;
        }

        if (recordTime !== null) {
          // Get the run start for this player
          const runStart = runStartTsBySession.get(sid) || firstTimerTs;
          
          // Count jumps from run start to cap
          total_jumps = replay.reduce((count, r) => {
            const [ts2, type2, data2] = r;
            if (
              ts2 >= runStart &&  // Changed: only count jumps after run start
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

  // ---------------------------
  // RACING MODE: FASTEST LAP
  // ---------------------------
  function detectFastestLap(replay, {
    allowBlueCaps,
    firstTimerTs,
    playersBySession,
    idToSession,
    sessionTeam
  }) {
    // Track per-player lap times
    const playerLaps = new Map(); // sessionId -> { laps: [{startTs, endTs, lapTime}], lastCapTs }
    
    let fastestLapTime = null;
    let fastestLapPlayer = null;
    let fastestLapPlayerId = null;
    let fastestLapPlayerQuote = null;
    let fastestLapJumps = null;
    let fastestLapStartTs = null;
    let fastestLapEndTs = null;

    const lastCapturesBySession = new Map();
    let lastScoreR = 0;
    let lastScoreB = 0;
    let lastScoreEventTsR = null;
    let lastScoreEventTsB = null;

    for (const [ts, type, data] of replay) {
      // Track score changes
      if (type === "score") {
        if (data.r > lastScoreR) {
          lastScoreEventTsR = ts;
        }
        if (data.b > lastScoreB) {
          lastScoreEventTsB = ts;
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

        // Verify score event occurred
        if (
          !(
            (teamNow === 1 && lastScoreEventTsR && ts >= lastScoreEventTsR) ||
            (teamNow === 2 && allowBlueCaps && lastScoreEventTsB && ts >= lastScoreEventTsB)
          )
        ) {
          continue;
        }

        // Initialize player lap tracking if needed
        if (!playerLaps.has(sid)) {
          playerLaps.set(sid, { laps: [], lastCapTs: firstTimerTs });
        }

        const playerData = playerLaps.get(sid);
        const lapStartTs = playerData.lastCapTs;
        const lapEndTs = ts;
        const lapTime = lapEndTs - lapStartTs;

        // Record this lap
        playerData.laps.push({ startTs: lapStartTs, endTs: lapEndTs, lapTime });
        playerData.lastCapTs = lapEndTs;

        // Check if this is the fastest lap
        if (fastestLapTime === null || lapTime < fastestLapTime) {
          fastestLapTime = lapTime;
          fastestLapStartTs = lapStartTs;
          fastestLapEndTs = lapEndTs;
          const p = playersBySession.get(sid);
          fastestLapPlayer = p?.name ?? null;
          fastestLapPlayerId = p?.user_id ?? null;

          // Count jumps during this lap
          fastestLapJumps = replay.reduce((count, r) => {
            const [ts2, type2, data2] = r;
            if (
              ts2 >= lapStartTs &&
              ts2 <= lapEndTs &&
              type2 === "replayPlayerMessage" &&
              data2?.type === "sound" &&
              data2?.data?.s === "jump"
            ) {
              return count + 1;
            }
            return count;
          }, 0);

          // Most recent chat from this player
          const playerChats = replay.filter(
            r => r[1] === "chat" && idToSession.get(r[2].from) === sid
          );
          fastestLapPlayerQuote = playerChats.length
            ? playerChats[playerChats.length - 1][2].message
            : null;
        }
      }
    }

    return {
      fastestLapTime,
      fastestLapPlayer,
      fastestLapPlayerId,
      fastestLapPlayerQuote,
      fastestLapJumps,
      allLaps: Array.from(playerLaps.entries()).map(([sid, data]) => ({
        sessionId: sid,
        player: playersBySession.get(sid)?.name,
        userId: playersBySession.get(sid)?.user_id,
        laps: data.laps
      }))
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
  let isRacingMode = false;
  let allowFromSpawn = false;
  let allowFromGrab = false;
  let ballsReq = null;

  if (matchedMap) {
    if (matchedMap.caps_to_win === "pups") {
      capsToWin = "-1"; // FIXED — Infinity cannot be matched
    } else {
      capsToWin = parseInt(matchedMap.caps_to_win || "1", 10);
    }
    effectiveMapId = matchedMap.map_id;
    allowBlueCaps = parseBool(matchedMap.allow_blue_caps);
    teamCapsMode = parseBool(matchedMap.team_caps);
    isRacingMode = parseBool(matchedMap.racing_mode);
    isRacingMode = parseBool(matchedMap.racing_mode);
    allowFromSpawn = parseBool(matchedMap.allow_from_spawn);
    allowFromGrab = parseBool(matchedMap.allow_from_grab);
    ballsReq = matchedMap.balls_req ? parseInt(matchedMap.balls_req, 10) : null;
  }

  // Count UNIQUE players (by userId) to handle team switch / refreshes
  const uniqueUserIds = new Set();
  for (const player of metadata.players) {
    if (player.userId) {
      uniqueUserIds.add(player.userId);
    } else {
      // For Some Balls (no userId), fall back to sessionId or id
      uniqueUserIds.add(player.sessionId || player.id);
    }
  }
  const actualPlayerCount = uniqueUserIds.size;

  // Disable allow_from_grab/spawn if TOO MANY unique players
  if (ballsReq !== null && actualPlayerCount > ballsReq) {
    allowFromSpawn = false;
    allowFromGrab = false;
  }

  // ---------------------------
  // CAPTURE DETECTION
  // ---------------------------
  const speedrunResult = detectCapture(replay, {
    teamCapsMode,
    allowBlueCaps,
    capsToWin,
    firstTimerTs,
    allowFromSpawn,
    allowFromGrab,
    playersBySession,
    idToSession,
    sessionTeam
  });

  // ---------------------------
  // RACING MODE DETECTION
  // ---------------------------
  let racingResult = null;
  if (isRacingMode) {
    racingResult = detectFastestLap(replay, {
      allowBlueCaps,
      firstTimerTs,
      playersBySession,
      idToSession,
      sessionTeam
    });
  }

  const baseResult = {
    map_name: mapData.info.name,
    map_id: effectiveMapId,
    actual_map_id: actualMapId,
    map_author: mapData.info.author,
    players: Object.values(players),
    is_solo: Object.keys(players).length === 1,
    timestamp: metadata.started,
    uuid: metadata.uuid,
    caps_to_win: capsToWin,
    allow_blue_caps: allowBlueCaps,
    is_racing_mode: isRacingMode,
  };

  // Return racing data if racing mode, otherwise speedrun data
  if (isRacingMode && racingResult) {
    return {
      ...baseResult,
      fastest_lap_time: racingResult.fastestLapTime,
      fastest_lap_player: racingResult.fastestLapPlayer,
      fastest_lap_player_user_id: racingResult.fastestLapPlayerId,
      fastest_lap_player_quote: racingResult.fastestLapPlayerQuote,
      fastest_lap_jumps: racingResult.fastestLapJumps,
      all_laps: racingResult.allLaps,
      // Keep speedrun data for reference
      speedrun_record_time: speedrunResult.recordTime,
      speedrun_capping_player: speedrunResult.cappingUserName,
      speedrun_total_jumps: speedrunResult.total_jumps,
    };
  } else {
    return {
      ...baseResult,
      capping_player: speedrunResult.cappingUserName,
      capping_player_user_id: speedrunResult.cappingUserId,
      record_time: speedrunResult.recordTime,
      capping_player_quote: speedrunResult.cappingPlayerQuote,
      total_jumps: speedrunResult.total_jumps,
    };
  }
}