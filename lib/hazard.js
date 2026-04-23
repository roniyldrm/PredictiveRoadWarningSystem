// Map a free-text alert_message from the backend to a short, loud hazard
// label suitable for both the red alert banner and the spoken warning.
//
// The backend's build_alert_message() concatenates weather / historical
// tokens like "heavy rain", "low visibility", "high wind", "accident zone",
// so we match on those substrings and pick the dominant one.

const RULES = [
  { match: /heavy rain|rain/i, label: 'Heavy Rain' },
  { match: /fog|visibility/i, label: 'Low Visibility' },
  { match: /high wind|strong wind|wind/i, label: 'Strong Winds' },
  { match: /ice|snow|frost|freezing/i, label: 'Icy Conditions' },
  { match: /accident|hotspot|zone/i, label: 'High Accident Zone' },
];

export function hazardTypeFrom(message) {
  if (!message || typeof message !== 'string') return 'High Risk';
  for (const rule of RULES) {
    if (rule.match.test(message)) return rule.label;
  }
  return 'High Risk';
}

// Compact phrase used by the speech engine. We keep it short so it finishes
// before the driver has moved meaningfully through the zone.
export function voicePhraseFor(hazardType) {
  if (!hazardType || hazardType === 'High Risk') {
    return 'Caution, high accident zone ahead, please slow down.';
  }
  return `Caution, ${hazardType.toLowerCase()} ahead, please slow down.`;
}
