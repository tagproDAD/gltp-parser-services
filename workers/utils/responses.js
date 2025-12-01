export function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  
  export function errorResponse(message, status = 500) {
    return jsonResponse({ ok: false, error: message }, status);
  }
  