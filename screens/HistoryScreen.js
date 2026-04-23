// Trip history — fetched live from GET /api/history/trips.
//
// Each card shows the four required fields:
//   - Date (of the trip's start)
//   - Duration (ended_at - started_at)
//   - Average risk score (0-100 derived from average_r_total)
//   - Alert count (High-risk zones entered)
//
// Cards are color-coded on the leading edge by average risk:
//   green  < 40   (safe)
//   amber  40-75  (medium)
//   red    > 75   (high)
//
// The list refreshes automatically whenever this screen gains focus
// (i.e. when the user switches back from the Live Drive tab after
// finishing a trip) and also via pull-to-refresh.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { useAuth } from '../auth/AuthContext';
import { historyApi, ApiError } from '../api/client';
import {
  colors,
  spacing,
  radius,
  typography,
  tapTarget,
  elevation,
} from '../theme/colors';

const RISK_TIERS = [
  { threshold: 0.4, label: 'LOW', color: colors.safe, tint: colors.safeTint },
  {
    threshold: 0.75,
    label: 'MEDIUM',
    color: colors.warn,
    tint: colors.warnTint,
  },
  {
    threshold: Infinity,
    label: 'HIGH',
    color: colors.danger,
    tint: colors.dangerTint,
  },
];

function tierFor(avg01) {
  for (const tier of RISK_TIERS) {
    if (avg01 < tier.threshold) return tier;
  }
  return RISK_TIERS[RISK_TIERS.length - 1];
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function TripCard({ trip }) {
  const avg01 =
    typeof trip.average_r_total === 'number' ? trip.average_r_total : 0;
  const avgPct = Math.round(avg01 * 100);
  const tier = tierFor(avg01);
  const alerts = trip.alert_count ?? 0;

  return (
    <View style={styles.card}>
      <View style={[styles.riskStrip, { backgroundColor: tier.color }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardRowTop}>
          <View>
            <Text style={styles.dateText}>{formatDate(trip.started_at)}</Text>
            <Text style={styles.timeText}>{formatTime(trip.started_at)}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: tier.color }]}>
            <Text style={styles.badgeText}>{tier.label}</Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <Metric
            icon={<Ionicons name="time-outline" size={16} color={colors.textMuted} />}
            label="Duration"
            value={formatDuration(trip.started_at, trip.ended_at)}
          />
          <Metric
            icon={
              <MaterialCommunityIcons
                name="gauge"
                size={16}
                color={colors.textMuted}
              />
            }
            label="Avg risk"
            value={`${avgPct}%`}
            valueColor={tier.color}
          />
          <Metric
            icon={
              <Ionicons
                name="warning-outline"
                size={16}
                color={alerts > 0 ? colors.danger : colors.textMuted}
              />
            }
            label="Alerts"
            value={String(alerts)}
            valueColor={alerts > 0 ? colors.danger : colors.text}
          />
        </View>
      </View>
    </View>
  );
}

function Metric({ icon, label, value, valueColor }) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricLabelRow}>
        {icon}
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
      <Text style={[styles.metricValue, valueColor && { color: valueColor }]}>
        {value}
      </Text>
    </View>
  );
}

export default function HistoryScreen() {
  const { token } = useAuth();
  const [trips, setTrips] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadTrips = useCallback(
    async ({ silent = false } = {}) => {
      if (!token) return;
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await historyApi.list(token, { limit: 100 });
        setTrips(Array.isArray(data?.trips) ? data.trips : []);
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : 'Could not load trip history.';
        setError(msg);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  // Refresh when the tab regains focus (e.g. returning from Live Drive
  // after ending a trip) so new trips show up immediately.
  useFocusEffect(
    useCallback(() => {
      loadTrips({ silent: true });
    }, [loadTrips]),
  );

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadTrips({ silent: true });
  }, [loadTrips]);

  if (isLoading && trips.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={styles.centeredLabel}>Loading trip history…</Text>
      </View>
    );
  }

  if (error && trips.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
        <Text style={[styles.centeredLabel, { marginTop: spacing.md }]}>
          {error}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => loadTrips()}
          accessibilityRole="button"
          accessibilityLabel="Retry loading trips"
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={trips}
        keyExtractor={(trip) => String(trip._id ?? trip.id)}
        renderItem={({ item }) => <TripCard trip={item} />}
        contentContainerStyle={
          trips.length === 0 ? styles.emptyContent : styles.listContent
        }
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyInner}>
            <MaterialCommunityIcons
              name="map-outline"
              size={56}
              color={colors.textSubtle}
            />
            <Text style={styles.emptyTitle}>No trips yet</Text>
            <Text style={styles.emptyBody}>
              Your saved drives will appear here after you stop a Live Drive session.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundMuted,
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
  retryButton: {
    marginTop: spacing.lg,
    minHeight: tapTarget,
    minWidth: 160,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: 120,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyInner: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    ...typography.heading,
    marginTop: spacing.md,
  },
  emptyBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...elevation.sm,
  },
  riskStrip: {
    width: 5,
  },
  cardBody: {
    flex: 1,
    padding: spacing.md,
  },
  cardRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  dateText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.2,
  },
  timeText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  badgeText: {
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metricsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  metric: {
    flex: 1,
  },
  metricLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metricLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: 4,
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginTop: 2,
  },
});
