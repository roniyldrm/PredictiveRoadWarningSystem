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
  { match: /accident|hotspot|zone/i, label: 'Accident-Prone Area' },
];

function normaliseLevel(level) {
  if (!level) return 'High';
  const s = String(level).trim();
  if (/^low$/i.test(s)) return 'Low';
  if (/^med/i.test(s)) return 'Medium';
  if (/^high$/i.test(s)) return 'High';
  return 'High';
}

// `message` = backend alert_message, `riskLevel` = Low | Medium | High
// from the same response.  We only show scary headlines ("High accident
// zone") when the server actually classifies the drive as High — otherwise
// a mention of "historical accidents" in the prose would contradict the
// big LOW/MEDIUM pill next to it.
export function hazardTypeFrom(message, riskLevel) {
  const level = normaliseLevel(riskLevel);
  if (!message || typeof message !== 'string') {
    if (level === 'Low') return 'All Clear';
    if (level === 'Medium') return 'Caution';
    return 'High Risk';
  }
  for (const rule of RULES) {
    if (!rule.match.test(message)) continue;
    if (rule.label === 'Accident-Prone Area') {
      if (level === 'High') return 'High Accident Zone';
      if (level === 'Medium') return 'Accident-Prone Area';
      // Low — the explanation may still textually mention the zone, but
      // the score is not alarming, so we soften the label.
      return 'Accident-Prone Area (low risk right now)';
    }
    return rule.label;
  }
  if (level === 'Low') return 'All Clear';
  if (level === 'Medium') return 'Caution';
  return 'High Risk';
}

// Compact phrase used by the speech engine. We keep it short so it finishes
// before the driver has moved meaningfully through the zone.
export function voicePhraseFor(hazardType) {
  if (!hazardType) {
    return 'Caution, please slow down and watch the road conditions.';
  }
  if (hazardType === 'All Clear') {
    return 'Caution, please drive according to current conditions.';
  }
  if (hazardType === 'High Risk' || hazardType === 'High Accident Zone') {
    return 'Caution, high accident zone ahead, please slow down.';
  }
  const spoken = String(hazardType)
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `Caution, ${spoken.toLowerCase()} ahead, please slow down.`;
}
