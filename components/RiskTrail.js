// Color-coded polyline overlay for the Live Drive map.
//
// Accepts a list of pre-grouped segments, each with a `risk_level` and a
// list of `{latitude, longitude}` points. Rendering is React.memoised with
// referential equality so the overlay only re-renders when the parent
// hands in a new segments array (which happens every ~3 s after a
// /predict-risk response), and NOT on every 1 Hz GPS tick.

import React from 'react';

import { Polyline } from './NativeMapModules';
import { colors } from '../theme/colors';

export const RISK_COLORS = {
  Low: colors.safe,
  Medium: '#F39C12',
  High: colors.danger,
};

function polylineColor(riskLevel) {
  return RISK_COLORS[riskLevel] || colors.safe;
}

function RiskTrail({ segments }) {
  if (!Polyline || !segments || segments.length === 0) return null;

  return (
    <>
      {segments.map((seg) => (
        <Polyline
          key={seg.id}
          coordinates={seg.points}
          strokeColor={polylineColor(seg.risk_level)}
          strokeWidth={6}
          lineCap="round"
          lineJoin="round"
          zIndex={2}
        />
      ))}
    </>
  );
}

// Re-render only when the segments array reference actually changes.
// The parent is responsible for creating a new array when (and only when)
// the risk overlay needs updating.
export default React.memo(RiskTrail, (prev, next) => prev.segments === next.segments);
