// Native-only re-export of the react-native-maps primitives.
// Metro picks this file automatically on iOS and Android because of the
// `.native.js` extension.

export {
  default as MapView,
  Marker,
  Polyline,
  Heatmap,
  PROVIDER_DEFAULT,
} from 'react-native-maps';
