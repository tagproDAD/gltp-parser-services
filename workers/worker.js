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
        record.origin = body.origin || "worker";
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

      // POST /upload (protected, unchanged except no parsing)
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

      // POST /bulk-upload → call Vercel for each UUID
      if (request.method === "POST" && path === "/bulk-upload") {
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
            const vercelRes = await fetch(VERCEL_PARSER_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ input: uuid, origin: "bulk" }),
            });
            const parsed = await vercelRes.json();

            if (!parsed.ok || !parsed.record) {
              results.push({ uuid, status: "invalid", reason: "No valid cap found" });
              continue;
            }

            const record = parsed.record;
            record.origin = r.origin || "bulk";
            record.timestamp_uploaded = Date.now();

            parsedRecords.push(record);
            results.push({ uuid, status: "parsed" });
          } catch (err) {
            results.push({ uuid, status: "error", reason: `Parse error: ${err.message}` });
          }
        }

        // Insert batch
        if (parsedRecords.length > 0) {
          const stmt = env.DB.prepare("INSERT OR IGNORE INTO gltp_records (uuid, payload) VALUES (?, ?)");
          await env.DB.batch(parsedRecords.map(r => stmt.bind(r.uuid, JSON.stringify(r))));
        }

        return jsonResponse({
          status: "success",
          totalReceived: records.length,
          parsed: parsedRecords.length,
          details: results,
          note: "Records parsed via Vercel; duplicates ignored via INSERT OR IGNORE",
        });
      }

      return errorResponse("Not found", 404);
    } catch (err) {
      return errorResponse(err.message || "Internal error", 500);
    }
  },
};
