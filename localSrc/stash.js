export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Helper for consistent JSON + CORS
    function createResponse(body, init = {}) {
      const headers = new Headers(init.headers || {});
      headers.set("Content-Type", "application/json");
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(JSON.stringify(body), { ...init, headers });
    }

    // OPTIONS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }

    // GET /records
    if (request.method === "GET" && url.pathname === "/records") {
      const results = await env.DB.prepare("SELECT payload FROM gltp_records").all();
      const parsed = results.results.map(r => JSON.parse(r.payload));
      return createResponse(parsed);
    }

    // Single record upload (explicit duplicate check)
    if (request.method === "POST" && url.pathname === "/upload") {
      const password = url.searchParams.get("password");
      if (password !== env.password) {
        return createResponse({ status: "error", message: "Unauthorized" }, { status: 401 });
      }

      let record;
      try {
        record = await request.json();
      } catch {
        return createResponse({ status: "error", message: "Invalid JSON" }, { status: 400 });
      }

      const existing = await env.DB.prepare("SELECT uuid FROM gltp_records WHERE uuid = ?")
        .bind(record.uuid).first();

      if (existing) {
        return createResponse({ status: "error", message: "Duplicate UUID" }, { status: 409 });
      }

      await env.DB.prepare(
        "INSERT INTO gltp_records (uuid, payload) VALUES (?, ?)"
      ).bind(record.uuid, JSON.stringify(record)).run();

      return createResponse({ status: "success", message: "Record added" }, { status: 201 });
    }

    // Bulk upload (INSERT OR IGNORE + summary)
    if (request.method === "POST" && url.pathname === "/bulk-upload") {
      const password = url.searchParams.get("password");
      if (password !== env.password) {
        return createResponse({ status: "error", message: "Unauthorized" }, { status: 401 });
      }

      let records;
      try {
        records = await request.json();
        if (!Array.isArray(records)) throw new Error("Payload must be an array");
      } catch {
        return createResponse({ status: "error", message: "Invalid JSON array" }, { status: 400 });
      }

      const stmt = env.DB.prepare(
        "INSERT OR IGNORE INTO gltp_records (uuid, payload) VALUES (?, ?)"
      );

      await env.DB.batch(records.map(r => stmt.bind(r.uuid, JSON.stringify(r))));

      // Count how many actually got inserted
      const total = records.length;
      const insertedCount = (await env.DB.prepare("SELECT COUNT(*) as c FROM gltp_records").first()).c;

      return createResponse({
        status: "success",
        totalReceived: total,
        message: "Bulk upload complete",
        note: "Duplicates were ignored",
        // optional: return counts
        insertedCount: insertedCount
      });
    }

    return createResponse({ status: "error", message: "Not found" }, { status: 404 });
  }
};
