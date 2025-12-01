// src/utils/auth.js
export function requireUploadKey(env, provided) {
    const secret = (env.UPLOAD_KEY || "").trim();
    if (!secret) return false;
    if (!provided) return false;
    return provided === secret;
  }
  
  export function getUploadKeyFromEnv(env) {
    return env.UPLOAD_KEY || "";
  }
  