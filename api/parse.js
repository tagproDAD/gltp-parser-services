import { parseReplayFromUUID } from "../lib/replayParser.js";
import { validateInput, normalizeReplayUrl } from "../lib/validation.js";
import { formatShortSummary } from "../lib/format.js";

export default async function handler(req, res) {
  try {
    const { input, origin } = req.body || {};
    if (!input) return res.status(400).json({ error: "Missing input" });

    const rawInput = String(input).trim();
    const type = validateInput(rawInput);

    let record;
    if (type === "replay") {
      const normalized = normalizeReplayUrl(rawInput);
      record = await parseReplayFromReplayLink(normalized);
    } else if (type === "uuid") {
      record = await parseReplayFromUUID(rawInput);
    } else {
      return res.status(400).json({ error: "Input not recognized" });
    }

    if (!record) {
      return res.status(400).json({ error: "No valid cap found" });
    }

    record.origin = origin || "vercel";
    record.timestamp_uploaded = Date.now();

    const summary = formatShortSummary(record);

    return res.status(200).json({ ok: true, summary, record });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
