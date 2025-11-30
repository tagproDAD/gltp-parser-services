// sanitizeInput.js

// Convert the URL to one that can be used to generate a replay file
function convertURL(url) {
    console.log(url);
    // URL looks like this: https://tagpro.koalabeast.com/game?replay=aBqgmEYJ6LRbiauGZTv8/iW0XY1d3tCp 
    // We need to conver the URL to https://tagpro.koalabeast.com/replays/gameFile?key=Z9/286ZugYquoKwYZ_ayjg7lzK42ipHD
    if (url.includes('replay=')) {
        console.log("yes");
        console.log(url);
        const id = url.split('replay=')[1];
        const convertedUrl = `https://tagpro.koalabeast.com/replays/gameFile?key=${id}`;
        console.log('Converted URL:', convertedUrl);
        return convertedUrl;
    } else {
        throw new Error("Invalid URL");
    }
}

export function sanitizeReplayInput(raw) {
  const str = String(raw).trim();

  try {
    const url = new URL(str);

    // Case 1: /replays?uuid=...
    if (url.pathname.includes("/replays")) {
      const uuid = url.searchParams.get("uuid");
      if (uuid) return uuid;
    }

    // Case 2: /game?replay=...
    if (url.pathname.includes("/game")) {
      console.log("here");
      const replayKey = url.searchParams.get("replay");
      if (replayKey) {
            return `https://tagpro.koalabeast.com/replays/gameFile?key=${replayKey}`;
      }
    }
  } catch {
    // Not a URL, fall through
  }

  // Case 3: raw UUID string
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(str)) return str;

  // Case 4: raw replay key (non-UUID, alphanumeric)
  if (/^[A-Za-z0-9]+$/.test(str)) return str;

  return null;
}
