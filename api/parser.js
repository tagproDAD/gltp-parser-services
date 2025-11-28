export default async function handler(req, res) {
  try {
    const { input } = req.body; // UUID
    if (!input) return res.status(400).json({ error: "Missing input" });

    // Fetch replay from TagPro
    const replayRes = await fetch(`https://tagpro.koalabeast.com/game/${input}/replay`);
    if (!replayRes.ok) {
      return res.status(500).json({ error: "Failed to fetch replay" });
    }
    const replay = await replayRes.json();

    // Minimal parsing logic
    const parsed = {
      uuid: input,
      map: replay.map?.name,
      players: replay.players?.map(p => p.name),
      caps: replay.caps || [],
    };

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
