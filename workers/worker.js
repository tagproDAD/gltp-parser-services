import { jsonResponse, errorResponse } from "./utils/responses.js";
import { insertIncompleteRecord } from "./db/insertIncompleteRecord.js";
import { insertNoPlayerRecord } from "./db/insertNoPlayerRecord.js";
import { insertRecord } from "./db/insertRecord.js";
import { insertError } from "./db/insertError.js";
import { formatShortSummary } from "./utils/format.js";

const VERCEL_PARSER_URL = "https://gltp-parser-services.vercel.app/api/parse";
const WORKER_PARSE_URL = "https://gltp.fwotagprodad.workers.dev/parse";
//const VERCEL_PARSER_URL = "http://localhost:3000/api/parse";

let cachedWRs = null;
let lastFetch = 0;
const CACHE_TTL = 10 * 60 * 1000; // 5 minutes in memory

export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);
            const path = url.pathname;
            const pathParts = url.pathname.split("/").filter(Boolean);

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

            if (request.method === "GET" && pathParts[0] === "pb" && pathParts[1]) {
                const playerName = decodeURIComponent(pathParts[1]);
                const mapId = pathParts[2] ? decodeURIComponent(pathParts[2]) : null;

                const ALIASES = {
                        "FWO": ["FWO", "DAD.", "::"],
                        "DAD.": ["FWO", "DAD.", "::"],
                        "::": ["FWO", "DAD.", "::"]
                    };

                const aliasSet = ALIASES[playerName] || [playerName];

                try {
                    // Build query
                    let query = `
                    SELECT map_id, map_name, record_time, total_jumps, payload, inserted_at
                    FROM gltp_records
                    `;
                    if (mapId) {
                    query += " WHERE map_id = ?";
                    }

                    const rows = mapId
                    ? await env.DB.prepare(query).bind(mapId).all()
                    : await env.DB.prepare(query).all();

                    const pbs = {};
                    for (const r of rows.results || []) {
                        const payload = JSON.parse(r.payload);
                        const players = payload.players.map(p => p.name);

                        if (players.some(name => aliasSet.includes(name))) {
                            if (!pbs[r.map_id]) {
                            pbs[r.map_id] = {
                                map_name: r.map_name,
                                fastestTime: r.record_time,
                                minJumps: r.total_jumps,
                                timestamp_uploaded: new Date(r.inserted_at).getTime()
                            };
                            } else {
                            if (r.record_time < pbs[r.map_id].fastestTime) {
                                pbs[r.map_id].fastestTime = r.record_time;
                                pbs[r.map_id].timestamp_uploaded = new Date(r.inserted_at).getTime();
                            }
                            if (r.total_jumps < pbs[r.map_id].minJumps) {
                                pbs[r.map_id].minJumps = r.total_jumps;
                                pbs[r.map_id].timestamp_uploaded = new Date(r.inserted_at).getTime();
                            }
                            }
                        }
                    }

                    return new Response(JSON.stringify(pbs), {
                    headers: { "Content-Type": "application/json" }
                    });
                } catch (err) {
                    return new Response(JSON.stringify({ error: "Failed to compute PBs", details: err.message }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                    });
                }
            }



            if (request.method === "GET" && path === "/wrs") {
                const now = Date.now();

                // Return in-memory cache if still valid
                if (cachedWRs && now - lastFetch < CACHE_TTL) {
                    return new Response(JSON.stringify(cachedWRs), {
                    headers: { "Content-Type": "application/json" }
                    });
                }

                // Try edge cache
                const cache = caches.default;
                let response = await cache.match(request);
                if (response) return response;

                try {
                    // Query D1 for WRs (fastest time + min jumps)
                    const rows = await env.DB.prepare(`
                    WITH fastest AS (
                        SELECT *,
                            ROW_NUMBER() OVER (
                                PARTITION BY map_id
                                ORDER BY record_time ASC
                            ) AS rn
                        FROM gltp_records
                    ),
                    minjumps AS (
                        SELECT *,
                            ROW_NUMBER() OVER (
                                PARTITION BY map_id
                                ORDER BY total_jumps ASC, record_time ASC
                            ) AS rn
                        FROM gltp_records
                    )
                    SELECT f.map_id,
                            f.map_name,
                            f.uuid AS uuid_time,
                            f.capping_player AS player_time,
                            f.record_time AS fastestTime,
                            f.inserted_at AS timestamp_uploaded_time,
                            j.uuid AS uuid_jumps,
                            j.capping_player AS player_jumps,
                            j.total_jumps AS minJumps,
                            j.inserted_at AS timestamp_uploaded_jumps
                    FROM fastest f
                    JOIN minjumps j ON f.map_id = j.map_id
                    WHERE f.rn = 1 AND j.rn = 1;
                    `).all();

                    const wrs = {};
                    for (const r of rows.results || []) {
                    wrs[r.map_id] = {
                        map_name: r.map_name,
                        fastestTime: r.fastestTime,
                        player_time: r.player_time,
                        uuid_time: r.uuid_time,
                        timestamp_uploaded_time: new Date(r.timestamp_uploaded_time).getTime(),
                        minJumps: r.minJumps,
                        player_jumps: r.player_jumps,
                        uuid_jumps: r.uuid_jumps,
                        timestamp_uploaded_jumps: new Date(r.timestamp_uploaded_jumps).getTime()
                    };
                    }

                    // Cache in memory
                    cachedWRs = wrs;
                    lastFetch = now;

                    // Cache at the edge for future requests
                    response = new Response(JSON.stringify(wrs), {
                    headers: {
                        "Content-Type": "application/json",
                        "Cache-Control": "s-maxage=900" // 15 minutes at edge
                    }
                    });
                    await cache.put(request, response.clone());

                    return response;
                } catch (err) {
                    console.error("❌ Failed to query WRs:", err);
                    return new Response(JSON.stringify({ error: "DB query failed" }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                    });
                }
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

            // DELETE /delete-record
            /*
            if (request.method === "DELETE" && path === "/delete-record") {
                let body;
                try {
                    body = await request.json();
                } catch {
                    return errorResponse("Invalid JSON body", 400);
                }

                const { uuid, password } = body || {};
                console.log("deleting UUID:");
                console.log(uuid);
                if (!uuid || typeof uuid !== "string") {
                    return errorResponse("Invalid UUID", 400);
                }
                if (password !== env.ADMIN_PASSWORD) {
                    return errorResponse("Unauthorized", 401);
                }

                try {
                    const stmt = env.DB.prepare("DELETE FROM gltp_records WHERE uuid = ? LIMIT 1");
                    const result = await stmt.bind(uuid).run();

                    if (result.success) {
                    return jsonResponse({ ok: true, deleted: uuid });
                    } else {
                    return errorResponse("Record not found or delete failed", 404);
                    }
                } catch (err) {
                    console.error("Delete error:", err);
                    return errorResponse("Database error", 500);
                }
            }
                */

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
                record.origin = body.origin || "Unknown cloudflare";
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

                // Union tables first, then filter once
                const stmt = env.DB.prepare(`
                    SELECT uuid, source
                    FROM (
                    SELECT uuid, 'records' AS source FROM gltp_records
                    UNION ALL
                    SELECT uuid, 'incomplete' AS source FROM gltp_incomplete_records
                    UNION ALL
                    SELECT uuid, 'noplayers' AS source FROM gltp_no_player_records
                    ) AS combined
                    WHERE uuid IN (${placeholders})
                `);

                let rows;
                try {
                    rows = await stmt.bind(...uuids).all();
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

           // POST /delayed-upload
            if (request.method === "POST" && path === "/delayed-upload") {
                let body;
                try {
                    body = await request.json();
                } catch {
                    return errorResponse("Invalid JSON body", 400);
                }

                const { input, origin } = body || {};
                if (!input || typeof input !== "string") {
                    return errorResponse("Missing 'input' UUID", 400);
                }

                // Validate UUID format
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (!uuidRegex.test(input)) {
                    return errorResponse("Invalid UUID format", 400);
                }

                const key = `uuid:${input}`;

                // Check if already queued
                const existing = await env.DELAYED_REPLAYS.get(key);
                if (existing) {
                    return jsonResponse({ ok: true, status: "already_queued", uuid: input });
                }

                const value = JSON.stringify({
                    origin: origin || "Unknown cloudflare",
                    timestamp: Date.now(),
                });

                try {
                    await env.DELAYED_REPLAYS.put(key, value);
                    console.log("Queued delayed upload:", key, value);
                    return jsonResponse({ ok: true, status: "queued", uuid: input });
                } catch (err) {
                    console.error("Failed to queue delayed upload:", err);
                    return errorResponse("Failed to queue UUID", 500);
                }
            }

            return errorResponse("Not found", 404);
        } catch (err) {
            return errorResponse(err.message || "Internal error", 500);
        }
    },

    async scheduled(controller, env, ctx) {
        console.log("Cron trigger fired at", controller.scheduledTime);
        const list = await env.DELAYED_REPLAYS.list();
        const now = Date.now();

        // Batch size to avoid overloading
        const batch = list.keys.slice(0, 20);

        for (const entry of batch) {
            const dataRaw = await env.DELAYED_REPLAYS.get(entry.name);
            if (!dataRaw) continue;

            const data = JSON.parse(dataRaw);
            // makes sure uuid is 65 minutes old
            if (now - data.timestamp >= 65 * 60 * 1000) {
                const uuid = entry.name.replace("uuid:", "");

                // Queue background work without blocking the scheduled handler
                ctx.waitUntil(
                    (async () => {
                    try {
                        // Instead of external fetch, call our own handler directly
                        const body = { input: uuid, origin: data.origin };
                        const request = new Request("https://internal/parse", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                        });

                        const res = await this.fetch(request, env, ctx);
                        const text = await res.text();

                        let parsed;
                        try {
                            parsed = JSON.parse(text);
                            console.log("Processed delayed UUID via /parse:", uuid, parsed);
                            // Remove from KV after successful processing
                            await env.DELAYED_REPLAYS.delete(entry.name);
                        } catch {
                            parsed = { ok: false, error: text };
                            console.log("failed delayed uuid via /parse:", uuid, parsed);
                            // leave in KV for retry
                        }
                    } catch (err) {
                        console.error("Error processing delayed UUID:", uuid, err);
                        // leave in KV for retry next cron run
                    }
                    })()
                );
            }
        }
    }

};