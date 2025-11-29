// api/parse.js
export default async function handler(req, res) {
  try {
    const { input, origin } = req.body || {};
    if (!input) {
      return res.status(400).json({ error: "Missing 'input' in request body" });
    }

    const uuid = String(input).trim();
    const uuidRegex = /^[0-9a-f-]{36}$/i;
    if (!uuidRegex.test(uuid)) {
      return res.status(400).json({ error: "Input must be a valid UUID" });
    }

    // Step 1: Fetch metadata
    const metadataRes = await fetch(`https://tagpro.koalabeast.com/replays/data?uuid=${uuid}`);
    if (!metadataRes.ok) {
      return res.status(500).json({ error: "Failed to fetch metadata" });
    }
    const metadata = await metadataRes.json();
    if (!metadata.games || metadata.games.length !== 1) {
      return res.status(500).json({ error: "Unexpected replay format" });
    }

    // Step 2: Fetch replay file
    const gameId = metadata.games[0].id;
    const replayRes = await fetch(`https://tagpro.koalabeast.com/replays/gameFile?gameId=${gameId}`);
    if (!replayRes.ok) {
      return res.status(500).json({ error: "Failed to fetch replay data" });
    }

    // Step 3: Parse replay lines
    const text = await replayRes.text();
    const lines = text.trim().split("\n").map(line => JSON.parse(line));

    // Step 4: Build record object (similar to Worker)
    const record = {
      uuid,
      gameId,
      origin: origin || "vercel",
      timestamp_uploaded: Date.now(),
      // You can enrich this with map/players/caps if you parse them from `lines`
      events: lines,
    };

    const summary = `Replay ${uuid} with ${lines.length} events`;

    return res.status(200).json({
      ok: true,
      summary,
      record,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
