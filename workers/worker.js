import { jsonResponse, errorResponse } from "./utils/responses.js";
import { requireUploadKey } from "./utils/auth.js";
import { insertRecord } from "./db/insertRecord.js";
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

      // GET /records (unchanged)
      if (request.method === "GET" && path === "/records") {
        const rows = await env.DB.prepare("SELECT payload FROM gltp_records").all();
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
          return errorResponse(`Failed to reach parser: ${err.message}`, 500);
        }

        if (!parsed.ok || !parsed.record) {
          return jsonResponse({
            ok: false,
            summary: parsed.summary || "Parse failed",
            error: parsed.error || "No record returned",
          }, 400);
        }

        const record = parsed.record;
        record.origin = body.origin || "cloudflare";
        record.timestamp_uploaded = Date.now();

        const summary = formatShortSummary(record);

        // Insert into D1
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
            return errorResponse(`Too many UUIDs. Max batch size is ${MAX_BATCH}`, 413); // 413 Payload Too Large
        }

        console.log('UUIDs received for checking:', uuids);

        const placeholders = uuids.map(() => "?").join(",");
        console.log('Generated placeholders:', placeholders);

        const stmt = env.DB.prepare(`SELECT uuid FROM gltp_records WHERE uuid IN (${placeholders})`);
        let rows;

        try {
            rows = await stmt.bind(...uuids).all();
            console.log('Database query result:', rows);
        } catch (err) {
            console.error('Database query error:', err);
            return errorResponse('Database error', 500);
        }

        // Ensure that rows.results is an array and each item has a uuid property
        if (!Array.isArray(rows.results)) {
            console.error('Unexpected database result format:', rows);
            return errorResponse('Database returned unexpected format', 500);
        }

        const existing = new Set(rows.results.map(r => r.uuid));
        const missing = uuids.filter(u => !existing.has(u));

        // Prepare response
        const response = {
            totalReceived: uuids.length,
            missingCount: missing.length,
            missing,
        };
        console.log('Response data:', response);

        return jsonResponse(response);
    }

      return errorResponse("Not found", 404);
    } catch (err) {
      return errorResponse(err.message || "Internal error", 500);
    }
  },
};
