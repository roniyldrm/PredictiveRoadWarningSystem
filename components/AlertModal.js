// High-contrast red alert banner.
//
// Per spec it must "not block the map entirely" while still being full-screen
// in feel. We render it as a large pinned card at the top of the screen
// (~45% tall) so the driver can still see the road on the map beneath it.
//
// Behaviour:
//   - Visible iff `visible` prop is true.
//   - Auto-dismisses after 5 seconds by calling `onDismiss()`.
//   - Tapping anywhere on the card also calls `onDismiss()`.
//   - A large DISMISS button is always rendered so it is never hidden
//     behind a scroll, the speed panel, or the tab bar.
//
// The parent (LiveDriveScreen) controls `visible`. Once dismissed, it
// should not reopen until the driver enters a new High-risk zone.

import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing, radius, tapTarget, typography } from '../theme/colors';

const { height: SCREEN_H } = Dimensions.get('window');
const AUTO_DISMISS_MS = 5000;

function AlertModal({
  visible,
  hazardType,
  message,
  riskScore,
  onDismiss,
}) {
  useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(() => onDismiss?.(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable
        style={styles.banner}
        onPress={onDismiss}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        <View style={styles.iconRow}>
          <View style={styles.iconCircle}>
            <Ionicons name="warning" size={44} color={colors.danger} />
          </View>
          {typeof riskScore === 'number' ? (
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreBadgeText}>
                {Math.round(riskScore)}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.hazardType}>
          {(hazardType || 'HIGH RISK').toUpperCase()}
        </Text>
        <Text style={styles.message} numberOfLines={3}>
          {message || 'High accident zone ahead.'}
        </Text>

        <TouchableOpacity
          style={styles.dismissButton}
          onPress={onDismiss}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Dismiss alert"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.dismissButtonText}>DISMISS</Text>
        </TouchableOpacity>
      </Pressable>
    </View>
  );
}

export default React.memo(AlertModal);

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Leave roughly the bottom half of the screen showing the map so the
    // driver still has spatial context while acknowledging the alert.
    height: Math.min(Math.round(SCREEN_H * 0.55), 520),
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    zIndex: 1000,
    elevation: 1000,
  },
  banner: {
    flex: 1,
    backgroundColor: colors.danger,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreBadge: {
    minWidth: 64,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  scoreBadgeText: {
    color: colors.onPrimary,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  hazardType: {
    ...typography.title,
    color: colors.onPrimary,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  message: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.onPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  dismissButton: {
    marginTop: spacing.lg,
    minHeight: tapTarget,
    minWidth: 220,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.danger,
    letterSpacing: 0.5,
  },
});
