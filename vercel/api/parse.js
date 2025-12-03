import { parseReplayFromUUID, parseReplayFromReplayLink } from "../lib/replayParser.js";

export default async function handler(req, res) {
  try {
    const { input, origin } = req.body || {};
    if (!input) {
      return res.status(400).json({ error: "Missing 'input' in request body" });
    }
    console.log("starting");
    let record;
    if (input.startsWith("http")) {
      console.log("linked");
      record = await parseReplayFromReplayLink(input);
    } else {
      console.log("uuid");
      record = await parseReplayFromUUID(input);
    }

    if (!record) {
      console.log("no cap found");
      return res.status(400).json({ error: "No valid cap found" });
    }

    record.origin = origin || "vercel";
    record.timestamp_uploaded = Date.now();

    return res.status(200).json({ ok: true, record });
  } catch (err) {
    console.error("Parse error:", err);
    return res.status(500).json({ error: err.message });
  }
}
