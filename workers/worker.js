import { jsonResponse, errorResponse } from "./utils/responses.js";
import { requireUploadKey } from "./utils/auth.js";
import { parseReplayFromUUID, parseReplayFromReplayLink } from "./parsers/replayParser.js";
import { insertRecord } from "./db/insertRecord.js";
import { formatShortSummary } from "./utils/format.js";

// Quick validation
function validateInput(input) {
  const validPrefix = "https://tagpro.koalabeast.com/";
  if (input.startsWith(validPrefix)) {
    if (input.includes("replay=")) return "replay";
    if (input.includes("uuid=")) return "uuid";
  }
  const uuidRegex = /^[0-9a-f-]{36}$/i;
  if (uuidRegex.test(input)) return "uuid";
  return "invalid";
}

// Normalize replay URLs
function normalizeReplayUrl(url) {
  if (url.includes("game?replay=")) {
    const id = new URL(url).searchParams.get("replay");
    return `https://tagpro.koalabeast.com/replays/gameFile?key=${id}`;
  }
  return url;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // OPTIONS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Key",
          },
        });
      }

      // GET /records
      if (request.method === "GET" && path === "/records") {
        const rows = await env.DB.prepare("SELECT payload FROM gltp_records").all();
        const arr = (rows.results || []).map(r => {
          try { return JSON.parse(r.payload); } catch { return r.payload; }
        });
        return jsonResponse(arr);
      }

      // POST /parse (public, auto-insert)
      if (request.method === "POST" && path === "/parse") {
        const body = await request.json().catch(() => null);
        if (!body || !body.input) {
          return errorResponse("Missing 'input' in request body", 400);
        }

        const rawInput = String(body.input || "").trim();
        const type = validateInput(rawInput);

        let record;
        try {
          if (type === "replay") {
            const normalized = normalizeReplayUrl(rawInput);
            record = await parseReplayFromReplayLink(normalized);
          } else if (type === "uuid") {
            record = await parseReplayFromUUID(rawInput);
          } else {
            throw new Error("Input not recognized as replay link or UUID");
          }
        } catch (err) {
          return jsonResponse({
            ok: false,
            summary: `Parse error: ${err.message}`,
            error: err.message,
          }, 400);
        }

        //  Skip if no valid cap
        if (!record) {
          return jsonResponse({ ok: false, summary: "No valid cap found", error: "Run not finished" }, 400);
        }
        // Add origin before insert
        record.origin = body.origin || "unknown";
        record.timestamp_uploaded = Date.now();

        const summary = formatShortSummary(record);

        // Inline insert logic
        let uploadResult;
        try {
          await insertRecord(env.DB, record);
          uploadResult = { status: 201, body: { ok: true, status: "inserted", summary } };
        } catch (err) {
          const msg = String(err?.message || err);
          if (msg.includes("UNIQUE") || msg.includes("constraint")) {
            uploadResult = { status: 409, body: { ok: false, status: "duplicate", summary } };
          } else {
            uploadResult = { status: 500, body: { error: `DB insert error: ${msg}` } };
          }
        }

        return jsonResponse({
          ok: true,
          summary,
          record,
          upload: uploadResult,
        });
      }

      // POST /upload (protected, for bots)
      if (request.method === "POST" && path === "/upload") {
        const provided = request.headers.get("X-Auth-Key") || request.headers.get("x-auth-key");
        if (!requireUploadKey(env, provided)) {
          return errorResponse("Unauthorized", 401);
        }

        const body = await request.json().catch(() => null);
        if (!body || !body.record) {
          return errorResponse("Missing 'record' in body", 400);
        }

        const record = body.record;
        if (!record.uuid) {
          return errorResponse("Record missing uuid", 400);
        }

        try {
          await insertRecord(env.DB, record);
          const summary = formatShortSummary(record);
          return jsonResponse({ ok: true, status: "inserted", summary }, 201);
        } catch (err) {
          const msg = String(err?.message || err);
          if (msg.includes("UNIQUE") || msg.includes("constraint")) {
            const summary = formatShortSummary(record);
            return jsonResponse({ ok: false, status: "duplicate", summary }, 409);
          }
          return errorResponse(`DB insert error: ${msg}`, 500);
        }
      }

    // Bulk upload endpoint (parse each UUID, insert full record)
    if (request.method === "POST" && url.pathname === "/bulk-upload") {
      let records;
      try {
        records = await request.json();
        if (!Array.isArray(records)) throw new Error("Payload must be an array");
      } catch {
        return errorResponse("Invalid JSON array", 400);
      }

      const parsedRecords = [];
      const results = [];

      for (const r of records) {
        const uuid = r?.uuid;
        if (!uuid) {
          results.push({ status: "invalid", reason: "Missing uuid" });
          continue;
        }

        try {
          // 👇 actually parse replay from UUID
          const record = await parseReplayFromUUID(uuid);

          if (!record) {
            results.push({ uuid, status: "invalid", reason: "No valid cap found" });
            continue;
          }

          record.origin = r.origin || "bulk";
          record.timestamp_uploaded = Date.now();

          parsedRecords.push(record);
          results.push({ uuid, status: "parsed" });
        } catch (err) {
          results.push({ uuid, status: "error", reason: `Parse error: ${err.message}` });
        }
      }

      // Count before insert
      const beforeCountRow = await env.DB.prepare("SELECT COUNT(*) as c FROM gltp_records").first();
      const beforeCount = beforeCountRow.c;

      // Batch insert only if we have records
      if (parsedRecords.length > 0) {
        const stmt = env.DB.prepare("INSERT OR IGNORE INTO gltp_records (uuid, payload) VALUES (?, ?)");
        await env.DB.batch(parsedRecords.map(r => stmt.bind(r.uuid, JSON.stringify(r))));
      }

      // Count after insert
      const afterCountRow = await env.DB.prepare("SELECT COUNT(*) as c FROM gltp_records").first();
      const afterCount = afterCountRow.c;

      // Summaries
      const totalReceived = records.length;
      const parsedCount = parsedRecords.length;
      const inserted = afterCount - beforeCount;
      const duplicates = parsedCount - inserted;
      const invalid = results.filter(r => r.status === "invalid").length;
      const errors = results.filter(r => r.status === "error").length;

      return jsonResponse({
        status: "success",
        totalReceived,
        parsed: parsedCount,
        inserted,
        duplicates,
        invalid,
        errors,
        details: results,
        note: "Records parsed from UUID; duplicates ignored via INSERT OR IGNORE",
      });
    }
      
      return errorResponse("Not found", 404);
    } catch (err) {
      return errorResponse(err.message || "Internal error", 500);
    }
  },
};
