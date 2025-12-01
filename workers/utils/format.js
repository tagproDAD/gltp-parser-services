export function formatShortSummary(record) {
    const timeMs = record.record_time;
    const formattedTime = (timeMs === null || timeMs === undefined) ? null : formatMilliseconds(timeMs);
    return {
      uuid: record.uuid || null,
      map_name: record.map_name || null,
      player: record.capping_player || null,
      time: formattedTime,
    };
  }
  
  function formatMilliseconds(ms) {
    if (ms === null || ms === undefined) return null;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const millis = ms % 1000;
    return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  }
  