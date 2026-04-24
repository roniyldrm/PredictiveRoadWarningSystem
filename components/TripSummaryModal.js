// Trip summary modal — shown after the user taps "Stop & Save Trip".
//
// Presents aggregated stats from the finished drive (duration, distance,
// avg + peak risk, alerts triggered, max speed, weather context) and a
// single context-aware recommendation from lib/recommendations.js.
//
// Pure presentational — all data is prepared by the parent before
// passing it in via `summary` and `recommendation` props.

import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  radius,
  elevation,
  typography,
  tapTarget,
} from '../theme/colors';

function riskTier(avg01) {
  if (avg01 == null) return { color: colors.textSubtle, label: '—', tint: colors.surfaceAlt };
  if (avg01 < 0.4) return { color: colors.safe, label: 'LOW', tint: colors.safeTint };
  if (avg01 < 0.75) return { color: colors.warn, label: 'MEDIUM', tint: colors.warnTint };
  return { color: colors.danger, label: 'HIGH', tint: colors.dangerTint };
}

function formatDuration(mins) {
  if (mins == null) return '—';
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} h` : `${h} h ${rem} min`;
}

function TripSummaryModal({ visible, summary, recommendation, onDismiss }) {
  if (!summary) return null;

  const tier = riskTier(summary.avgRisk);
  const peakTier = riskTier(summary.peakRisk);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Drag handle */}
          <View style={styles.handle} />

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {/* Hero */}
            <View style={styles.hero}>
              <View style={[styles.heroBadge, { backgroundColor: tier.tint }]}>
                <Ionicons name="flag" size={28} color={tier.color} />
              </View>
              <Text style={typography.label}>Trip complete</Text>
              <Text style={styles.heroTitle}>
                {formatDuration(summary.durationMinutes)}
                {summary.distanceKm != null
                  ? ` · ${summary.distanceKm.toFixed(1)} km`
                  : ''}
              </Text>
            </View>

            {/* Recommendation card — the headline takeaway */}
            {recommendation ? (
              <View
                style={[
                  styles.recoCard,
                  { backgroundColor: colors.accentTint, borderColor: colors.accent },
                ]}
              >
                <View style={styles.recoHeader}>
                  <View style={styles.recoIcon}>
                    <Ionicons
                      name={recommendation.icon || 'bulb'}
                      size={22}
                      color={colors.accent}
                    />
                  </View>
                  <Text style={typography.label}>Recommendation</Text>
                </View>
                <Text style={styles.recoTitle}>{recommendation.title}</Text>
                <Text style={styles.recoBody}>{recommendation.body}</Text>
              </View>
            ) : null}

            {/* Stats grid */}
            <View style={styles.statsGrid}>
              <Stat
                icon={
                  <MaterialCommunityIcons
                    name="gauge"
                    size={22}
                    color={tier.color}
                  />
                }
                value={
                  summary.avgRisk != null
                    ? `${Math.round(summary.avgRisk * 100)}%`
                    : '—'
                }
                label="Avg risk"
                tintColor={tier.color}
              />
              <Stat
                icon={
                  <MaterialCommunityIcons
                    name="alert-octagon-outline"
                    size={22}
                    color={peakTier.color}
                  />
                }
                value={
                  summary.peakRisk != null
                    ? `${Math.round(summary.peakRisk * 100)}%`
                    : '—'
                }
                label="Peak risk"
                tintColor={peakTier.color}
              />
              <Stat
                icon={
                  <Ionicons
                    name="warning-outline"
                    size={22}
                    color={
                      summary.alertCount > 0 ? colors.danger : colors.textSubtle
                    }
                  />
                }
                value={String(summary.alertCount ?? 0)}
                label="Alerts"
                tintColor={
                  summary.alertCount > 0 ? colors.danger : colors.text
                }
              />
              <Stat
                icon={
                  <MaterialCommunityIcons
                    name="speedometer"
                    size={22}
                    color={colors.accent}
                  />
                }
                value={
                  summary.maxSpeedKmh != null
                    ? `${Math.round(summary.maxSpeedKmh)} km/h`
                    : '—'
                }
                label="Max speed"
              />
            </View>

            {/* Conditions summary */}
            {summary.conditions ? (
              <View style={styles.condCard}>
                <Text style={typography.label}>Road Conditions</Text>
                <View style={styles.condGrid}>
                  <CondItem
                    icon="weather-pouring"
                    label="Rainfall"
                    value={`${summary.conditions.rain_mm ?? 0} mm/h`}
                  />
                  <CondItem
                    icon="eye"
                    label="Visibility"
                    value={
                      summary.conditions.visibility_m != null
                        ? `${(summary.conditions.visibility_m / 1000).toFixed(1)} km`
                        : '—'
                    }
                  />
                  <CondItem
                    icon="weather-windy"
                    label="Wind"
                    value={
                      summary.conditions.wind_speed != null
                        ? `${summary.conditions.wind_speed.toFixed(1)} m/s`
                        : '—'
                    }
                  />
                  <CondItem
                    icon="thermometer"
                    label="Temperature"
                    value={
                      summary.conditions.temperature != null
                        ? `${summary.conditions.temperature.toFixed(1)}°C`
                        : '—'
                    }
                  />
                </View>
              </View>
            ) : null}

            {summary.saved === false ? (
              <Text style={styles.saveWarning}>
                {summary.saveError
                  ? `Trip not saved: ${summary.saveError}`
                  : 'Trip not saved.'}
              </Text>
            ) : null}
          </ScrollView>

          <TouchableOpacity
            style={styles.dismissButton}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close trip summary"
            activeOpacity={0.85}
          >
            <Text style={styles.dismissButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default React.memo(TripSummaryModal);

// ---- bits ---------------------------------------------------------------

function Stat({ icon, value, label, tintColor }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={[styles.statValue, tintColor && { color: tintColor }]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function CondItem({ icon, label, value }) {
  return (
    <View style={styles.condItem}>
      <View style={styles.condIcon}>
        <MaterialCommunityIcons name={icon} size={18} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.condLabel}>{label}</Text>
        <Text style={styles.condValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: spacing.xl,
    maxHeight: '92%',
    ...elevation.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  heroTitle: {
    ...typography.title,
    marginTop: 4,
  },
  recoCard: {
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  recoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  recoIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  recoTitle: {
    ...typography.heading,
    marginTop: 4,
  },
  recoBody: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: 4,
    lineHeight: 22,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.xs,
    marginBottom: spacing.md,
  },
  stat: {
    width: '50%',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
  },
  statLabel: {
    ...typography.caption,
    marginTop: 2,
  },
  condCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...elevation.sm,
    marginBottom: spacing.md,
  },
  condGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    marginHorizontal: -spacing.xs,
  },
  condItem: {
    width: '50%',
    flexDirection: 'row',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  condIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  condLabel: {
    ...typography.caption,
  },
  condValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  saveWarning: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerTint,
    color: colors.danger,
    fontWeight: '600',
    textAlign: 'center',
  },
  dismissButton: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    minHeight: tapTarget,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.md,
  },
  dismissButtonText: {
    color: colors.onPrimary,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
