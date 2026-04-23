// Account tab — user profile, session stats, logout.
//
// Stats are computed on the fly from /api/history/trips so we don't add
// a new backend endpoint for something the UI can aggregate itself.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
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
  elevation,
  typography,
  tapTarget,
} from '../theme/colors';

export default function AccountScreen() {
  const { user, token, signOut } = useAuth();

  const [stats, setStats] = useState({ trips: 0, alerts: 0, avgRisk: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadStats = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await historyApi.list(token, { limit: 200 });
      const trips = Array.isArray(data?.trips) ? data.trips : [];
      const totalAlerts = trips.reduce(
        (acc, t) => acc + (t.alert_count || 0),
        0,
      );
      const avgRisk =
        trips.length > 0
          ? trips.reduce((acc, t) => acc + (t.average_r_total || 0), 0) /
            trips.length
          : null;
      setStats({ trips: trips.length, alerts: totalAlerts, avgRisk });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not load your stats.',
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [loadStats]),
  );

  const displayName = user?.full_name || user?.email || 'Driver';
  const initial = (displayName[0] || '?').toUpperCase();

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* Hero — avatar + email */}
      <View style={styles.hero}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {displayName}
        </Text>
        {user?.email && user?.full_name ? (
          <Text style={styles.email} numberOfLines={1}>
            {user.email}
          </Text>
        ) : null}
      </View>

      {/* Stats card */}
      <View style={styles.statsCard}>
        <Text style={typography.label}>Your Driving</Text>

        {loading ? (
          <View style={styles.statsLoading}>
            <ActivityIndicator color={colors.textMuted} />
          </View>
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <View style={styles.statsGrid}>
            <Stat
              icon={
                <MaterialCommunityIcons
                  name="map-marker-path"
                  size={22}
                  color={colors.accent}
                />
              }
              label="Trips"
              value={String(stats.trips)}
            />
            <Stat
              icon={
                <Ionicons name="warning" size={22} color={colors.danger} />
              }
              label="Alerts"
              value={String(stats.alerts)}
            />
            <Stat
              icon={
                <MaterialCommunityIcons
                  name="gauge"
                  size={22}
                  color={colors.safe}
                />
              }
              label="Avg risk"
              value={
                stats.avgRisk != null
                  ? `${Math.round(stats.avgRisk * 100)}%`
                  : '—'
              }
            />
          </View>
        )}
      </View>

      {/* Preferences section placeholder */}
      <View style={styles.section}>
        <Text style={typography.label}>Preferences</Text>
        <View style={styles.rowCard}>
          <Row icon="volume-high" label="Voice alerts" value="Enabled" />
          <Divider />
          <Row icon="speedometer" label="Risk polling" value="Every 3 s" />
          <Divider />
          <Row icon="map" label="Hazard radius" value="500 m" />
        </View>
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={typography.label}>About</Text>
        <View style={styles.rowCard}>
          <Row icon="shield-checkmark" label="App" value="RoadSense" />
          <Divider />
          <Row icon="cog" label="Version" value="0.1.0" />
        </View>
      </View>

      <TouchableOpacity
        style={styles.signOutButton}
        onPress={signOut}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        activeOpacity={0.85}
      >
        <Ionicons name="log-out-outline" size={22} color={colors.danger} />
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>

      <View style={{ height: 140 }} />
    </ScrollView>
  );
}

function Stat({ icon, label, value }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ icon, label, value }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={colors.textMuted} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.backgroundMuted,
  },
  content: {
    padding: spacing.md,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    ...elevation.md,
  },
  avatarText: {
    color: colors.onPrimary,
    fontSize: 36,
    fontWeight: '800',
  },
  name: {
    ...typography.title,
    textAlign: 'center',
  },
  email: {
    ...typography.caption,
    marginTop: 2,
  },
  statsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...elevation.sm,
  },
  statsLoading: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  errorText: {
    marginTop: spacing.sm,
    color: colors.danger,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
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
  section: {
    marginTop: spacing.lg,
  },
  rowCard: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...elevation.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  rowIcon: {
    width: 28,
    alignItems: 'center',
  },
  rowLabel: {
    flex: 1,
    marginLeft: spacing.sm,
    ...typography.body,
  },
  rowValue: {
    ...typography.bodyMuted,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSoft,
    marginLeft: spacing.md + 28 + spacing.sm,
  },
  signOutButton: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: tapTarget,
    borderRadius: radius.md,
    backgroundColor: colors.dangerTint,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  signOutText: {
    marginLeft: spacing.sm,
    color: colors.danger,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
