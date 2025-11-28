// api/parse.js
export default async function handler(req, res) {
  try {
    const { input, origin } = req.body || {};
    if (!input) {
      return res.status(400).json({ error: "Missing 'input' in request body" });
    }

    const rawInput = String(input).trim();

    // --- Validation (same as Worker) ---
    const validPrefix = "https://tagpro.koalabeast.com/";
    let type = "invalid";
    if (rawInput.startsWith(validPrefix)) {
      if (rawInput.includes("replay=")) type = "replay";
      if (rawInput.includes("uuid=")) type = "uuid";
    }
    const uuidRegex = /^[0-9a-f-]{36}$/i;
    if (uuidRegex.test(rawInput)) type = "uuid";

    if (type === "invalid") {
      return res.status(400).json({ error: "Input not recognized as replay link or UUID" });
    }

    // --- Normalize replay URL ---
    let replayUrl;
    if (type === "replay") {
      if (rawInput.includes("game?replay=")) {
        const id = new URL(rawInput).searchParams.get("replay");
        replayUrl = `https://tagpro.koalabeast.com/replays/gameFile?key=${id}`;
      } else {
        replayUrl = rawInput;
      }
    } else if (type === "uuid") {
      // UUID → direct replay file
      replayUrl = `https://tagpro.koalabeast.com/replays/${rawInput}.json`;
    }

    // --- Fetch replay ---
    const replayRes = await fetch(replayUrl, { headers: { "Accept": "application/json" } });
    if (!replayRes.ok) {
      return res.status(500).json({ error: `Failed to fetch replay: ${replayRes.status}` });
    }
    const replay = await replayRes.json();

    // --- Minimal parsing (mirror Worker’s record object) ---
    // NOTE: Adjust fields based on what your replay JSON actually contains
    const record = {
      uuid: rawInput,
      map: replay.map?.name || null,
      players: replay.players?.map(p => ({
        name: p.name,
        team: p.team,
        score: p.score,
      })) || [],
      caps: replay.caps || [],
      origin: origin || "vercel",
      timestamp_uploaded: Date.now(),
    };

    // Short summary (like Worker’s formatShortSummary)
    const summary = `Map: ${record.map}, Caps: ${record.caps.length}, Players: ${record.players.length}`;

    return res.status(200).json({
      ok: true,
      summary,
      record,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}