// Alerts tab — live road-risk snapshot for the driver's current location.
//
// Unlike the Live Drive tab (which polls while you're driving), this is a
// point-in-time "how dangerous is it here, right now?" view. It:
//   1. Grabs a single GPS fix via expo-location
//   2. Posts it to /api/predict-risk
//   3. Renders the risk score, level, alert message, weather + accident
//      density that produced that score
//   4. Supports pull-to-refresh
//
// Everything re-renders off a single `snapshot` object so there is zero
// animation complexity — this screen is for at-a-glance reading.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { useAuth } from '../auth/AuthContext';
import { riskApi, ApiError } from '../api/client';
import { hazardTypeFrom } from '../lib/hazard';
import {
  colors,
  spacing,
  radius,
  elevation,
  typography,
  tapTarget,
} from '../theme/colors';

const RISK_STYLES = {
  Low: { color: colors.safe, tint: colors.safeTint, label: 'LOW' },
  Medium: { color: colors.warn, tint: colors.warnTint, label: 'MEDIUM' },
  High: { color: colors.danger, tint: colors.dangerTint, label: 'HIGH' },
};

function riskStyle(level) {
  return RISK_STYLES[level] || RISK_STYLES.Low;
}

export default function AlertSimulationScreen() {
  const { token } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [snapshot, setSnapshot] = useState(null);

  const loadSnapshot = useCallback(
    async ({ silent = false } = {}) => {
      if (!token) return;
      if (!silent) setIsLoading(true);
      setError(null);

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          throw new Error(
            'Location permission is required to read current road risk.',
          );
        }
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const { latitude, longitude, speed, heading } = fix.coords;
        const result = await riskApi.predict(token, {
          latitude,
          longitude,
          speed: Math.max(0, speed ?? 0),
          heading: heading != null && heading >= 0 ? heading : 0,
        });
        setSnapshot({
          takenAt: new Date(),
          latitude,
          longitude,
          risk: result,
        });
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 502) {
            setError('Weather service unavailable. Please retry shortly.');
          } else if (err.status === 503) {
            setError('Risk engine is warming up. Please retry shortly.');
          } else {
            setError(err.message);
          }
        } else {
          setError(err.message || 'Unable to read current risk.');
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadSnapshot({ silent: true });
  }, [loadSnapshot]);

  // ---- render ----------------------------------------------------------

  if (isLoading && !snapshot) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={styles.centeredLabel}>Reading current conditions…</Text>
      </View>
    );
  }

  if (error && !snapshot) {
    return (
      <View style={styles.centered}>
        <View style={[styles.iconBubble, { backgroundColor: colors.dangerTint }]}>
          <Ionicons name="cloud-offline-outline" size={36} color={colors.danger} />
        </View>
        <Text style={[styles.centeredLabel, { marginTop: spacing.md }]}>{error}</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => loadSnapshot()}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { risk, takenAt, latitude, longitude } = snapshot;
  const conditions = risk.conditions || {};
  const tier = riskStyle(risk.risk_level);
  const hazardType = hazardTypeFrom(risk.alert_message, risk.risk_level);
  const scoreRounded = Math.round(risk.risk_score ?? 0);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={typography.label}>Current Road Risk</Text>
        <Text style={styles.snapshotTime}>Updated {formatTime(takenAt)}</Text>
      </View>

      {/* Hero risk card */}
      <View style={[styles.heroCard, { backgroundColor: tier.tint }]}>
        <View style={styles.heroRow}>
          <View style={[styles.badge, { backgroundColor: tier.color }]}>
            <Text style={styles.badgeText}>{tier.label} RISK</Text>
          </View>
          <View style={styles.scoreGroup}>
            <Text style={[styles.scoreValue, { color: tier.color }]}>{scoreRounded}</Text>
            <Text style={[styles.scoreUnit, { color: tier.color }]}>/100</Text>
          </View>
        </View>

        <Text style={styles.hazardType}>{hazardType}</Text>
        {risk.alert_message ? (
          <Text style={styles.hazardMessage}>{risk.alert_message}</Text>
        ) : null}

        <View style={[styles.scoreBarTrack, { backgroundColor: `${tier.color}20` }]}>
          <View
            style={[
              styles.scoreBarFill,
              {
                backgroundColor: tier.color,
                width: `${Math.min(100, Math.max(2, scoreRounded))}%`,
              },
            ]}
          />
          <View style={[styles.scoreThreshold, { left: '40%' }]} />
          <View style={[styles.scoreThreshold, { left: '75%' }]} />
        </View>
        <View style={styles.scoreLegend}>
          <Text style={styles.scoreLegendText}>Low</Text>
          <Text style={[styles.scoreLegendText, { color: colors.warn }]}>Medium</Text>
          <Text style={[styles.scoreLegendText, { color: colors.danger }]}>High</Text>
        </View>
      </View>

      {/* Location card */}
      <View style={styles.card}>
        <Text style={typography.label}>Location</Text>
        <View style={styles.locationRow}>
          <View style={[styles.iconBubble, { backgroundColor: colors.accentTint }]}>
            <Ionicons name="location" size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={styles.latlonText}>
              {latitude.toFixed(4)}°, {longitude.toFixed(4)}°
            </Text>
            <Text style={styles.mutedCaption}>
              Read from your device's GPS
            </Text>
          </View>
        </View>
      </View>

      {/* Conditions grid */}
      <View style={styles.card}>
        <Text style={typography.label}>Conditions</Text>
        <View style={styles.grid}>
          <Metric
            icon={<MaterialCommunityIcons name="weather-pouring" size={22} color={colors.accent} />}
            label="Rainfall"
            value={`${conditions.rain_mm ?? 0} mm/h`}
          />
          <Metric
            icon={<MaterialCommunityIcons name="eye" size={22} color={colors.accent} />}
            label="Visibility"
            value={
              conditions.visibility_m != null
                ? `${Math.round(conditions.visibility_m / 100) / 10} km`
                : '—'
            }
          />
          <Metric
            icon={<MaterialCommunityIcons name="weather-windy" size={22} color={colors.accent} />}
            label="Wind"
            value={
              conditions.wind_speed != null
                ? `${conditions.wind_speed.toFixed(1)} m/s`
                : '—'
            }
          />
          <Metric
            icon={<MaterialCommunityIcons name="thermometer" size={22} color={colors.accent} />}
            label="Temperature"
            value={
              conditions.temperature != null
                ? `${conditions.temperature.toFixed(1)}°C`
                : '—'
            }
          />
        </View>
      </View>

      {/* Accident history card */}
      <View style={styles.card}>
        <Text style={typography.label}>Historical Accidents (500m)</Text>
        <View style={styles.locationRow}>
          <View style={[styles.iconBubble, { backgroundColor: colors.dangerTint }]}>
            <MaterialCommunityIcons
              name="map-marker-alert"
              size={22}
              color={colors.danger}
            />
          </View>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={styles.bigNumber}>{conditions.h_loc_count ?? 0}</Text>
            <Text style={styles.mutedCaption}>
              Known accidents within 500 m of this point in the last 5 years
            </Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, styles.refreshButton]}
        onPress={() => loadSnapshot()}
        accessibilityRole="button"
        accessibilityLabel="Refresh risk snapshot"
      >
        <Ionicons name="refresh" size={20} color={colors.onPrimary} />
        <Text style={[styles.primaryButtonText, { marginLeft: spacing.sm }]}>
          Refresh
        </Text>
      </TouchableOpacity>

      {error ? (
        <Text style={styles.inlineError}>{error}</Text>
      ) : null}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

function Metric({ icon, label, value }) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricIcon}>{icon}</View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function formatTime(d) {
  if (!(d instanceof Date)) return '';
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.backgroundMuted,
  },
  content: {
    padding: spacing.md,
    paddingTop: spacing.md,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  centeredLabel: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  iconBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    marginBottom: spacing.md,
  },
  snapshotTime: {
    ...typography.caption,
    marginTop: 4,
  },
  heroCard: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...elevation.sm,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  badgeText: {
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  scoreGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  scoreValue: {
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -1,
  },
  scoreUnit: {
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 4,
  },
  hazardType: {
    ...typography.heading,
    fontSize: 20,
    marginTop: spacing.md,
  },
  hazardMessage: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: 6,
  },
  scoreBarTrack: {
    height: 8,
    borderRadius: 4,
    marginTop: spacing.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  scoreThreshold: {
    position: 'absolute',
    top: -2,
    width: 2,
    height: 12,
    backgroundColor: 'rgba(15,23,42,0.28)',
  },
  scoreLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  scoreLegendText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.safe,
    letterSpacing: 0.4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...elevation.sm,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  latlonText: {
    ...typography.heading,
    letterSpacing: 0.2,
  },
  mutedCaption: {
    ...typography.caption,
    marginTop: 4,
  },
  bigNumber: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    marginHorizontal: -spacing.xs,
  },
  metric: {
    width: '50%',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  metricIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  metricLabel: {
    ...typography.caption,
  },
  primaryButton: {
    minHeight: tapTarget,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    flexDirection: 'row',
    ...elevation.md,
  },
  refreshButton: {
    marginTop: 0,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  inlineError: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.dangerTint,
    color: colors.danger,
    fontWeight: '600',
    borderRadius: radius.md,
    textAlign: 'center',
  },
});
