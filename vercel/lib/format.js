// lib/format.js

export function formatShortSummary(record) {
  const map = record.map_name || "Unknown Map";
  const capper = record.capping_player || "Unknown Player";
  const time =
    record.record_time !== null && record.record_time !== undefined
      ? formatMilliseconds(record.record_time)
      : "N/A";
  const jumps = record.total_jumps ?? 0;

  return `${capper} capped on ${map} in ${time} with ${jumps} jumps`;
}

function formatMilliseconds(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = (milliseconds % 60000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}
