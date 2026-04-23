// Web stub — react-native-maps has no web build. Metro picks this file
// (.web.js) when bundling for web; consumers treat the exports as
// possibly-null and render a fallback.
//
// We intentionally do NOT render a Leaflet-based map here:
//   - Leaflet's internal z-index tiers leaked over the HUD / alert modal.
//   - The web target in this project is only used for light screenshots
//     (login, history, logout). The real experience is on native.

export const MapView = null;
export const Marker = null;
export const Polyline = null;
export const PROVIDER_DEFAULT = undefined;

export default null;
