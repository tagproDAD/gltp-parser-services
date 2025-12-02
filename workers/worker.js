import { jsonResponse, errorResponse } from "./utils/responses.js";
import { insertIncompleteRecord } from "./db/insertIncompleteRecord.js";
import { insertNoPlayerRecord } from "./db/insertNoPlayerRecord.js";
import { insertRecord } from "./db/insertRecord.js";
import { insertError } from "./db/insertError.js";
import { formatShortSummary } from "./utils/format.js";

const VERCEL_PARSER_URL = "https://gltp-parser-services.vercel.app/api/parse";

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

      // GET /incomplete-records
      if (request.method === "GET" && path === "/incomplete-records") {
        const rows = await env.DB.prepare("SELECT payload FROM gltp_incomplete_records").all();
        const arr = (rows.results || []).map(r => {
          try { return JSON.parse(r.payload); } catch { return r.payload; }
        });
        return jsonResponse(arr);
      }

      // GET /noplayers
      if (request.method === "GET" && path === "/noplayers") {
        const rows = await env.DB.prepare("SELECT payload FROM gltp_no_player_records").all();
        const arr = (rows.results || []).map(r => {
          try { return JSON.parse(r.payload); } catch { return r.payload; }
        });
        return jsonResponse(arr);
      }

      // POST /parse → delegate to Vercel
      if (request.method === "POST" && path === "/parse") {
        const body = await request.json().catch(() => null);
        if (!body || !body.input) {
            return errorResponse("Missing 'input' in request body", 400);
        }

        // Call Vercel parser
        let parsed;
        try {
            const vercelRes = await fetch(VERCEL_PARSER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            });
            parsed = await vercelRes.json();
        } catch (err) {
            await insertError(env.DB, body.input, `Parser unreachable: ${err.message}`);
            return errorResponse(`Failed to reach parser: ${err.message}`, 500);
        }

        // Parser failed or returned no record
        if (!parsed.ok || !parsed.record) {
            await insertError(env.DB, body.input, parsed.error || "Parse failed");
            return jsonResponse({
            ok: false,
            summary: parsed.summary || "Parse failed",
            error: parsed.error || "No record returned",
            }, 400);
        }

        // Parser succeeded
        const record = parsed.record;
        record.origin = "data migration";
        record.timestamp_uploaded = Date.now();

        const summary = formatShortSummary(record);

        let uploadResult;
        try {
            if (record.record_time && record.capping_player) {
                // Successful completion
                console.log('Inserting Completion Record', record);
                await insertRecord(env.DB, record);
                uploadResult = { status: 201, body: { ok: true, status: "inserted", summary } };
            } else if (Array.isArray(record.players) && record.players.length > 0) {
                // Incomplete run with players
                console.log('Inserting Non Complete Record', record);
                await insertIncompleteRecord(env.DB, record);
                uploadResult = { status: 201, body: { ok: true, status: "logged_incomplete", summary } };
            } else {
                // No players
                console.log('No players found', record);
                await insertNoPlayerRecord(env.DB, record);
                uploadResult = { status: 201, body: { ok: true, status: "logged_no_players", summary } };
            }
        } catch (err) {
            // Use record.uuid if available, otherwise fall back to body.input
            const msg = String(err?.message || err);
            if (msg.includes("UNIQUE") || msg.includes("constraint")) {
                uploadResult = { status: 409, body: { ok: false, status: "duplicate", summary } };
            } else {
                const uuidToLog = record?.uuid || body.input;
                try {
                    await insertError(env.DB, uuidToLog, `DB insert error: ${msg}`);
                } catch (logErr) {
                    console.error("Failed to log error:", logErr);
                }
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

    if (request.method === "POST" && path === "/check-errors") {
        let uuids;
        try {
            uuids = await request.json();
            if (!Array.isArray(uuids)) throw new Error("Payload must be an array of UUIDs");
        } catch {
            return errorResponse("Invalid JSON array", 400);
        }

        const MAX_BATCH = 100;
        if (uuids.length > MAX_BATCH) {
            return errorResponse(`Too many UUIDs. Max batch size is ${MAX_BATCH}`, 413);
        }

        // Validate UUIDs before querying
        const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const safeUuids = uuids.filter(u => typeof u === "string" && regex.test(u));

        if (safeUuids.length === 0) {
            return jsonResponse({
            totalReceived: uuids.length,
            foundCount: 0,
            missingCount: uuids.length,
            existing: [],
            missing: uuids
            });
        }

        const placeholders = safeUuids.map(() => "?").join(",");
        const stmt = env.DB.prepare(`SELECT uuid FROM gltp_errors WHERE uuid IN (${placeholders})`);

        let rows;
        try {
            rows = await stmt.bind(...safeUuids).all();
        } catch (err) {
            console.error("Database query error:", err);
            return errorResponse("Database error", 500);
        }

        const existing = rows.results.map(r => r.uuid);
        const existingSet = new Set(existing);
        const missing = uuids.filter(u => !existingSet.has(u));

        return jsonResponse({
            totalReceived: uuids.length,
            foundCount: existing.length,
            missingCount: missing.length,
            existing,
            missing
        });
    }


    if (request.method === "POST" && path === "/check-uuids") {
        let uuids;
        try {
            uuids = await request.json();
            if (!Array.isArray(uuids)) throw new Error("Payload must be an array of UUIDs");
        } catch (err) {
            console.error("Error parsing UUIDs from request:", err);
            return errorResponse("Invalid JSON array", 400);
        }

        const MAX_BATCH = 100;
        if (uuids.length > MAX_BATCH) {
            return errorResponse(`Too many UUIDs. Max batch size is ${MAX_BATCH}`, 413);
        }

        console.log("UUIDs received for checking:", uuids);

        const placeholders = uuids.map(() => "?").join(",");

        // Efficient single query across all three tables
        const stmt = env.DB.prepare(`
            SELECT uuid, 'records' AS source FROM gltp_records WHERE uuid IN (${placeholders})
            UNION
            SELECT uuid, 'incomplete' AS source FROM gltp_incomplete_records WHERE uuid IN (${placeholders})
            UNION
            SELECT uuid, 'noplayers' AS source FROM gltp_no_player_records WHERE uuid IN (${placeholders})
        `);

        let rows;
        try {
            // Bind UUIDs three times (once per IN clause)
            rows = await stmt.bind(...uuids, ...uuids, ...uuids).all();
            console.log("Database query result:", rows);
        } catch (err) {
            console.error("Database query error:", err);
            return errorResponse("Database error", 500);
        }

        if (!Array.isArray(rows.results)) {
            console.error("Unexpected database result format:", rows);
            return errorResponse("Database returned unexpected format", 500);
        }

        // Build existing list with source info
        const existing = rows.results.map(r => ({ uuid: r.uuid, source: r.source }));
        const existingSet = new Set(existing.map(r => r.uuid));
        const missing = uuids.filter(u => !existingSet.has(u));

        // Count by source
        const countsBySource = existing.reduce((acc, r) => {
            acc[r.source] = (acc[r.source] || 0) + 1;
            return acc;
        }, {});

        // Prepare response
        const response = {
            totalReceived: uuids.length,
            foundCount: existing.length,
            missingCount: missing.length,
            countsBySource,   // e.g. { records: 12, incomplete: 5, noplayers: 3 }
            existing,         // detailed list of found UUIDs with source
            missing           // list of UUIDs not found in any table
        };

        console.log("Response data:", response);
        return jsonResponse(response);
    }


      return errorResponse("Not found", 404);
    } catch (err) {
      return errorResponse(err.message || "Internal error", 500);
    }
  },
};
