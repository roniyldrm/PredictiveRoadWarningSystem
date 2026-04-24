// Risk Heatmap — aggregates every risk-tagged GPS point across the user's
// trip history into a single heatmap overlay on the map. Lets the driver
// see WHERE their personal danger clusters are.
//
// Data flow:
//   parent (HistoryScreen) passes the already-fetched list of trips in.
//   We flatten all `route[].r_total` points, weight each by its risk,
//   and render them via react-native-maps' <Heatmap>. Map is centred on
//   the centroid so the view automatically frames the dataset.
//
// Only points with r_total >= MIN_WEIGHT are included so low-risk stretches
// don't paint the whole country green.

import React, { useMemo } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import {
  MapView,
  PROVIDER_DEFAULT,
  Heatmap,
} from './NativeMapModules';
import {
  colors,
  spacing,
  radius,
  elevation,
  typography,
} from '../theme/colors';

// Points below this are ignored — clean stretches of road aren't useful
// on a heatmap and they dilute the visually interesting hotspots.
const MIN_WEIGHT = 0.3;

// Soft red→amber→green inverted so HIGH risk = red, LOW = safe green.
// Gradients on react-native-maps' Heatmap take matched `colors` + `startPoints`.
const GRADIENT = {
  colors: ['#10B98144', '#F59E0B', '#EF4444'],
  startPoints: [0.1, 0.4, 0.85],
  colorMapSize: 256,
};

function RiskHeatmapModal({ visible, trips, onClose }) {
  const { points, center } = useMemo(() => buildDataset(trips), [trips]);

  const hasMap = MapView && Heatmap;
  const hasPoints = points.length > 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View>
            <Text style={typography.label}>Your personal hotspots</Text>
            <Text style={styles.title}>Risk Heatmap</Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close heatmap"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.closeButton}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.mapWrap}>
          {hasMap ? (
            <MapView
              style={StyleSheet.absoluteFillObject}
              provider={PROVIDER_DEFAULT}
              initialRegion={{
                latitude: center.latitude,
                longitude: center.longitude,
                latitudeDelta: 0.4,
                longitudeDelta: 0.4,
              }}
              showsCompass={false}
              showsMyLocationButton={false}
              toolbarEnabled={false}
            >
              {hasPoints ? (
                <Heatmap
                  points={points}
                  opacity={0.75}
                  radius={45}
                  gradient={GRADIENT}
                />
              ) : null}
            </MapView>
          ) : (
            <View style={styles.webFallback}>
              <Text style={styles.webFallbackText}>
                Heatmap is only available on iOS and Android builds.
              </Text>
            </View>
          )}

          {hasMap && !hasPoints ? (
            <View style={styles.emptyBadge}>
              <Text style={styles.emptyText}>
                No risky points yet. Drive a few trips and they'll appear here.
              </Text>
            </View>
          ) : null}
        </View>

        {/* Legend strip */}
        {hasMap ? (
          <View style={styles.legend}>
            <View style={styles.legendSwatch}>
              <View style={[styles.legendDot, { backgroundColor: colors.safe }]} />
              <Text style={styles.legendText}>Safe</Text>
            </View>
            <View style={styles.legendSwatch}>
              <View style={[styles.legendDot, { backgroundColor: colors.warn }]} />
              <Text style={styles.legendText}>Medium</Text>
            </View>
            <View style={styles.legendSwatch}>
              <View style={[styles.legendDot, { backgroundColor: colors.danger }]} />
              <Text style={styles.legendText}>High</Text>
            </View>
            <View style={{ flex: 1 }} />
            <Text style={styles.legendText}>
              {points.length} point{points.length === 1 ? '' : 's'}
            </Text>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

export default React.memo(RiskHeatmapModal);

// ---- dataset prep -------------------------------------------------------

function buildDataset(trips) {
  if (!Array.isArray(trips) || trips.length === 0) {
    return {
      points: [],
      center: { latitude: 41.0082, longitude: 28.9784 },
    };
  }

  const points = [];
  let sumLat = 0;
  let sumLon = 0;
  let geoCount = 0;

  for (const trip of trips) {
    if (!Array.isArray(trip?.route)) continue;
    for (const p of trip.route) {
      if (
        typeof p?.latitude !== 'number' ||
        typeof p?.longitude !== 'number'
      ) {
        continue;
      }
      sumLat += p.latitude;
      sumLon += p.longitude;
      geoCount += 1;

      const weight =
        typeof p.r_total === 'number'
          ? p.r_total
          : typeof trip.average_r_total === 'number'
            ? trip.average_r_total
            : 0;
      if (weight < MIN_WEIGHT) continue;

      points.push({
        latitude: p.latitude,
        longitude: p.longitude,
        weight,
      });
    }
  }

  const center = geoCount > 0
    ? { latitude: sumLat / geoCount, longitude: sumLon / geoCount }
    : { latitude: 41.0082, longitude: 28.9784 };

  return { points, center };
}

// ---- styles ------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.title,
    marginTop: 2,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapWrap: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  webFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  webFallbackText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  emptyBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...elevation.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    gap: spacing.md,
  },
  legendSwatch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    ...typography.caption,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
