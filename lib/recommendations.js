// Trip-end recommendation engine.
//
// Takes an aggregated `stats` object (distance, duration, speeds, risk,
// weather conditions, time-of-day) and returns ONE headline recommendation
// plus a short supporting line. Rules are ordered by priority — the first
// match wins, so more specific / more actionable tips come first.
//
// Easy to extend: add another object to RULES with a `match(stats)`
// predicate and a `{ icon, title, body }` payload. Keep each tip short
// (≤ 80 chars) — the modal shows it in ~2 lines.

// ---- rules ordered most-specific first ----------------------------------
const RULES = [
  {
    id: 'very_high_risk_peak',
    icon: 'warning',
    title: 'High-risk zone ahead next time',
    body: 'Your peak risk was very high. Consider an alternate route or leave earlier to avoid it.',
    match: (s) => (s.peakRisk ?? 0) >= 0.85,
  },
  {
    id: 'multiple_alerts',
    icon: 'alert-circle',
    title: 'Multiple hazard zones triggered',
    body: 'You entered several high-risk areas. Slow down on familiar routes too — complacency is common there.',
    match: (s) => (s.alertCount ?? 0) >= 3,
  },
  {
    id: 'icy_roads',
    icon: 'snow-outline',
    title: 'Watch for black ice',
    body: 'Near-freezing temperatures. Bridges and shaded corners freeze first — reduce speed and avoid sharp braking.',
    match: (s) =>
      s.conditions?.temperature != null && s.conditions.temperature <= 3,
  },
  {
    id: 'heavy_rain',
    icon: 'rainy-outline',
    title: 'Wet roads spotted',
    body: 'It was raining during your drive. Double your following distance and check tyre tread tonight.',
    match: (s) => (s.conditions?.rain_mm ?? 0) >= 1.0,
  },
  {
    id: 'low_visibility',
    icon: 'eye-off-outline',
    title: 'Low visibility on route',
    body: 'Fog or haze cut visibility below 1 km. Use dipped headlights — never high-beams — in fog.',
    match: (s) =>
      s.conditions?.visibility_m != null &&
      s.conditions.visibility_m < 1000,
  },
  {
    id: 'high_winds',
    icon: 'trending-up',
    title: 'Strong crosswinds',
    body: 'Wind speeds were gusty. Grip the wheel firmly on bridges and open motorway stretches.',
    match: (s) => (s.conditions?.wind_speed ?? 0) >= 10.8,
  },
  {
    id: 'speeding',
    icon: 'speedometer-outline',
    title: 'High peak speed',
    body: 'Your top speed was above 110 km/h. Staying 5–10 km/h under the limit cuts braking distance a lot.',
    match: (s) => (s.maxSpeedKmh ?? 0) >= 110,
  },
  {
    id: 'long_drive',
    icon: 'time-outline',
    title: 'Long stretch — take a break',
    body: 'You drove for over 2 hours. Fatigue hits hardest after 90 minutes — grab a short break next time.',
    match: (s) => (s.durationMinutes ?? 0) >= 120,
  },
  {
    id: 'night_drive',
    icon: 'moon-outline',
    title: 'Night driving tip',
    body: 'Night crashes are 3× more likely. Keep the dashboard dim and your eyes moving to avoid highway hypnosis.',
    match: (s) => {
      const h = s.endedAt?.getHours?.();
      return typeof h === 'number' && (h >= 21 || h < 6);
    },
  },
  {
    id: 'rush_hour',
    icon: 'car-sport-outline',
    title: 'Rush-hour drive',
    body: 'Peak traffic hours — most rear-end crashes happen here. Leave an extra car length in front of you.',
    match: (s) => {
      const h = s.endedAt?.getHours?.();
      return (
        typeof h === 'number' &&
        ((h >= 7 && h <= 9) || (h >= 17 && h <= 19))
      );
    },
  },
  {
    id: 'hot_weather',
    icon: 'sunny-outline',
    title: 'Hot driving conditions',
    body: 'Hot weather stresses tyres and batteries. Check tyre pressure cool, and keep hydrated.',
    match: (s) =>
      s.conditions?.temperature != null && s.conditions.temperature >= 30,
  },
  {
    id: 'hotspot_area',
    icon: 'map',
    title: 'Accident-dense area',
    body: 'Your route passed through a segment with many historical accidents. Defensive driving matters here.',
    match: (s) => (s.conditions?.h_loc_count ?? 0) >= 100,
  },
  {
    id: 'short_hop',
    icon: 'walk-outline',
    title: 'Short trip — consider walking',
    body: 'Under 2 km — most engine wear and emissions happen in the first minutes. Could this be a walk or bike ride?',
    match: (s) => (s.distanceKm ?? 0) < 2 && (s.distanceKm ?? 0) > 0,
  },
  {
    id: 'clean_run',
    icon: 'checkmark-circle',
    title: 'Clean run — well done',
    body: 'No alerts triggered and risk stayed low. Keep the steady driving style next time too.',
    match: (s) =>
      (s.alertCount ?? 0) === 0 &&
      (s.peakRisk ?? 0) < 0.4 &&
      (s.distanceKm ?? 0) >= 2,
  },
  {
    id: 'default',
    icon: 'shield-checkmark-outline',
    title: 'Drive safe out there',
    body: 'Stay alert, signal early, and leave space. Small habits stack up.',
    match: () => true,
  },
];

export function recommendFor(stats) {
  for (const rule of RULES) {
    try {
      if (rule.match(stats)) return rule;
    } catch {
      // Defensive — a malformed stat should never crash the summary.
      continue;
    }
  }
  return RULES[RULES.length - 1];
}

// Expose rule IDs so tests / ad-hoc scripts can compare.
export const RECOMMENDATION_IDS = RULES.map((r) => r.id);
