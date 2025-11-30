// src/index.js
import { extractReplaySource } from "./src/parse.js";
import { normalizeRecord } from "./src/normalize.js";
import { insertRecord } from "./src/insert.js";
import { jsonError, createResponse } from "./src/utils.js";


export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Route based on pathname
    if (url.pathname === "/upload" && request.method === "POST") {
      return handleUpload(request, env);
    }
    if (url.pathname === "/records" && request.method === "GET") {
      return handleRecords(env);
    }

    return new Response("Not found", { status: 404 });
  },
};

// Handle /upload: parse + insert
async function handleUpload(request, env) {
  try {
    const { input, uploaded_from = "unknown" } = await request.json();
    if (!input) return jsonError("Missing replay input", 400);

    const source = extractReplaySource(input.trim());
    if (!source) return jsonError("Unsupported input", 400);

    // Build replay URL
    const replayUrl =
      source.type === "uuid"
        ? `https://tagpro.koalabeast.com/replays?uuid=${source.uuid}`
        : `https://tagpro.koalabeast.com/replays/gameFile?key=${source.key}`;

    const replayRes = await fetch(replayUrl);
    if (!replayRes.ok) return jsonError("Replay not found", 404);

    const replayData = await replayRes.json();

    // Normalize record
    const record = normalizeRecord(replayData, {
      uuid: source.type === "uuid" ? source.uuid : replayData?.uuid ?? source.key,
      uploaded_from,
    });

    if (!record.capping_player) {
      return jsonError("Run not finished — no capping player", 400);
    }

    // Insert into DB
    await insertRecord(record, env);

    return new Response(JSON.stringify({ success: true, record }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return jsonError(err.message || "Unexpected error", 500);
  }
}

// Handle /records: list records
async function handleRecords(env) {
    const results = await env.DB.prepare("SELECT payload FROM gltp_records").all();
    const parsed = results.results.map(r => JSON.parse(r.payload));

    return createResponse(parsed);
}