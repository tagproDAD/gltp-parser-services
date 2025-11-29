// lib/format.js

export function formatShortSummary(record) {
  const map = record.map_name || "Unknown Map";
  const capper = record.capping_player || "Unknown Player";
  const time = record.record_time ? `${record.record_time}ms` : "N/A";
  const jumps = record.total_jumps ?? 0;

  return `${capper} capped on ${map} in ${time} with ${jumps} jumps`;
}
