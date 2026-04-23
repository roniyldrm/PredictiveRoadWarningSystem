// Live Drive screen — real-time GPS + risk polling.
//
// Architecture (performance-oriented)
// -----------------------------------
// * The MapView is mounted exactly once per screen lifetime. We never pass
//   `region={...}` because that would force a re-render on every GPS tick.
//   Instead we hold a ref to the MapView and call `animateCamera` imperatively
//   from the 1 Hz telemetry subscription.
//
// * The user marker is an isolated memoised component (<UserMarker />) so
//   only that one child re-renders when coordinates change. react-native-maps
//   performs the on-screen translation natively.
//
// * <RiskTrail /> is memoised with referential equality on its `segments`
//   prop. Segments are only rebuilt when a new /predict-risk response comes
//   back (every ~3 s), NOT on the 1 Hz telemetry. This is the "only update
//   the risk overlay layer" requirement.
//
// * Hot telemetry is held in a ref (`latestFixRef`) so the 3 s polling
//   interval can read it without re-subscribing or causing extra renders.
//
// Data flow
// ---------
//   expo-location watchPositionAsync (1 Hz)
//     → latestFixRef.current        (ref: always fresh, no render)
//     → setPosition(...)            (state: drives marker + HUD)
//
//   setInterval 3 s
//     → read latestFixRef
//     → POST /api/predict-risk {latitude, longitude, speed, heading}
//     → setRisk({ risk_level, alert_message, risk_score })
//     → append segment to trail using the in-flight breadcrumb

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../auth/AuthContext';
import { riskApi, historyApi, ApiError } from '../api/client';
import AlertModal from '../components/AlertModal';
import RiskTrail, { RISK_COLORS } from '../components/RiskTrail';
import { hazardTypeFrom, voicePhraseFor } from '../lib/hazard';
import { colors, spacing, radius, tapTarget, typography } from '../theme/colors';

// Metro picks NativeMapModules.native.js on iOS/Android and
// NativeMapModules.web.js on web. The web shim exports nulls, so
// `react-native-maps` is never resolved in a web bundle.
import {
  MapView,
  Marker,
  PROVIDER_DEFAULT,
} from '../components/NativeMapModules';

const TELEMETRY_INTERVAL_MS = 1000; // 1 Hz
const POLL_INTERVAL_MS = 3000; // every 3 s
const TRAIL_MAX_POINTS_PER_SEGMENT = 40; // cap per-segment coords for render cost
const TRAIL_MAX_SEGMENTS = 20;
// Spec: show alert + speak when backend returns risk_score > 75. We use a
// slightly lower exit threshold (hysteresis) so the "zone" state doesn't
// flap while the driver is sitting right on the boundary.
const HAZARD_ENTER_SCORE = 75;
const HAZARD_EXIT_SCORE = 65;
// Cap the recorded route so a very long trip doesn't build a huge payload.
const TRIP_ROUTE_MAX_POINTS = 2000;

// Stable, non-rendering "not yet known" sentinels.
const INITIAL_REGION = {
  latitude: 41.0082,
  longitude: 28.9784,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

// ---------------------------------------------------------------------
// Isolated user marker — only this subtree re-renders on each GPS tick.
// ---------------------------------------------------------------------
const UserMarker = React.memo(function UserMarker({ coordinate, heading }) {
  if (!Marker || !coordinate) return null;
  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      flat
      rotation={Number.isFinite(heading) ? heading : 0}
      tracksViewChanges={false}
    >
      <View style={markerStyles.outer}>
        <View style={markerStyles.inner} />
      </View>
    </Marker>
  );
});

const markerStyles = StyleSheet.create({
  outer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(17,17,17,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: colors.background,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
});

// ---------------------------------------------------------------------

export default function LiveDriveScreen() {
  const { token } = useAuth();

  // Driving session state
  const [isActive, setIsActive] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState('undetermined');
  const [permissionError, setPermissionError] = useState(null);

  // Position state — drives the HUD + the marker component.
  // Splitting out `coordinate` from the broader fix keeps the marker prop
  // referentially stable when only speed/heading change (it doesn't, but
  // it's cheap to future-proof).
  const [position, setPosition] = useState(null); // { latitude, longitude, speed, heading }

  // Risk state — updated every ~3 s.
  const [risk, setRisk] = useState(null); // { risk_level, alert_message, risk_score }
  const [pollError, setPollError] = useState(null);

  // Breadcrumb segments for the risk overlay.
  // A new array reference is produced only when the risk state changes.
  const [trailSegments, setTrailSegments] = useState([]);

  // Alert modal visibility. The modal opens on every new zone ENTRY
  // (score rises above HAZARD_ENTER_SCORE after previously being below it)
  // and closes on user dismiss OR after 5s (handled inside AlertModal).
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  // Trip-saving progress indicator (for the stop button).
  const [savingTrip, setSavingTrip] = useState(false);

  // Refs: hot values read without re-renders.
  const mapRef = useRef(null);
  const latestFixRef = useRef(null);
  const locationSubRef = useRef(null);
  const pollTimerRef = useRef(null);
  const pollAbortRef = useRef(null);
  const activeSegmentRef = useRef(null); // points accumulating under the current risk level
  const segmentIdRef = useRef(0);

  // Per-session collection state (kept in refs so the 1 Hz subscription
  // can mutate without triggering extra renders).
  const sessionStartRef = useRef(null);      // Date of trip start
  const routeRef = useRef([]);               // Array of TripPoint
  const lastRiskScore01Ref = useRef(null);   // 0-1 score tagged onto new TripPoints
  const riskSumRef = useRef(0);              // running sum of r_total samples (0-1)
  const riskCountRef = useRef(0);            // count of r_total samples
  const hazardActiveRef = useRef(false);     // true while inside a high-risk zone
  // Latest risk snapshot mirrored into a ref so callbacks can read it
  // without re-creating the poll effect on every state change.
  const latestRiskRef = useRef(null);

  // ----- Permission + location lifecycle --------------------------------

  const resetSessionCollectors = useCallback(() => {
    sessionStartRef.current = new Date();
    routeRef.current = [];
    lastRiskScore01Ref.current = null;
    riskSumRef.current = 0;
    riskCountRef.current = 0;
    hazardActiveRef.current = false;
    latestRiskRef.current = null;
    setAlertCount(0);
    setAlertVisible(false);
    setRisk(null);
    setTrailSegments([]);
  }, []);

  const startSession = useCallback(async () => {
    setPermissionError(null);
    setPollError(null);

    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermissionStatus(status);
    if (status !== 'granted') {
      setPermissionError(
        'Location permission is required to monitor road risk.',
      );
      return;
    }

    resetSessionCollectors();

    try {
      const first = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      handleFix(first);
      animateTo(first.coords);
    } catch (err) {
      setPermissionError('Unable to acquire a GPS fix. Try moving outdoors.');
      return;
    }

    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: TELEMETRY_INTERVAL_MS,
        distanceInterval: 0,
      },
      handleFix,
    );
    locationSubRef.current = sub;

    setIsActive(true);
  }, [resetSessionCollectors]);

  // Tear down subscriptions/timers but DON'T post the trip — that is done
  // explicitly by `stopSession` (below) so we can distinguish "user ended
  // trip" from "component unmounted mid-flight".
  const teardownSession = useCallback(() => {
    setIsActive(false);
    if (locationSubRef.current) {
      locationSubRef.current.remove();
      locationSubRef.current = null;
    }
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (pollAbortRef.current) {
      pollAbortRef.current.abort();
      pollAbortRef.current = null;
    }
    // Stop any in-flight speech so it doesn't keep talking post-trip.
    try {
      Speech.stop();
    } catch {}
  }, []);

  const stopSession = useCallback(async () => {
    // Snapshot what we need BEFORE teardown resets state.
    const startedAt = sessionStartRef.current;
    const routePoints = routeRef.current.slice();
    const avg01 =
      riskCountRef.current > 0
        ? riskSumRef.current / riskCountRef.current
        : 0;
    const alerts = alertCount;

    teardownSession();

    if (!token || !startedAt || routePoints.length === 0) return;

    setSavingTrip(true);
    try {
      await historyApi.create(token, {
        started_at: startedAt.toISOString(),
        ended_at: new Date().toISOString(),
        route: routePoints,
        average_r_total: clamp01(avg01),
        alert_count: alerts,
      });
    } catch (err) {
      setPollError(
        err instanceof ApiError
          ? `Trip not saved: ${err.message}`
          : 'Trip not saved. Please try again.',
      );
    } finally {
      setSavingTrip(false);
    }
  }, [alertCount, teardownSession, token]);

  // Full teardown on unmount (no trip POST — the user didn't press Stop).
  useEffect(() => () => teardownSession(), [teardownSession]);

  // ----- Fix handling ---------------------------------------------------

  const handleFix = useCallback((fix) => {
    if (!fix || !fix.coords) return;
    const { latitude, longitude, speed, heading } = fix.coords;

    // Clamp heading into [0, 360); expo-location emits -1 when unknown.
    const safeHeading =
      typeof heading === 'number' && heading >= 0 && heading <= 360
        ? heading
        : null;
    const safeSpeed =
      typeof speed === 'number' && speed >= 0 ? speed : 0;

    const next = {
      latitude,
      longitude,
      speed: safeSpeed,
      heading: safeHeading,
    };
    latestFixRef.current = next;
    setPosition(next);

    animateTo({ latitude, longitude });

    // Record this fix as a TripPoint for the eventual history POST.
    // Backend expects speed_kmh (optional) and r_total (0-1, optional).
    if (routeRef.current.length < TRIP_ROUTE_MAX_POINTS) {
      routeRef.current.push({
        latitude,
        longitude,
        timestamp: new Date(fix.timestamp ?? Date.now()).toISOString(),
        speed_kmh: safeSpeed * 3.6,
        r_total: lastRiskScore01Ref.current,
      });
    }

    if (activeSegmentRef.current) {
      const seg = activeSegmentRef.current;
      seg.points.push({ latitude, longitude });
      if (seg.points.length > TRAIL_MAX_POINTS_PER_SEGMENT) {
        seg.points.shift();
      }
    }
  }, []);

  const animateTo = useCallback((coord) => {
    const map = mapRef.current;
    if (!map || !coord) return;
    map.animateCamera(
      { center: coord, zoom: 16 },
      { duration: 500 },
    );
  }, []);

  // ----- Voice alert (must be declared before polling effect that uses it).

  const speakHazard = useCallback((message) => {
    // Fire-and-forget. expo-speech uses the platform TTS engine:
    //   iOS:     AVSpeechSynthesizer — respects the ringer silent switch
    //            (media category), so "Silent Mode" mutes the warning.
    //   Android: plays through the music stream, honouring the user's
    //            media volume; it does NOT observe "Do Not Disturb".
    // We stop any currently speaking utterance first so overlapping zone
    // entries can't queue up.
    try {
      Speech.stop();
      Speech.speak(voicePhraseFor(hazardTypeFrom(message)), {
        language: 'en-US',
        rate: 1.0,
        pitch: 1.0,
      });
    } catch {
      // If TTS isn't available, fail silently — the visual alert remains.
    }
  }, []);

  // ----- Risk polling (every 3 s) ---------------------------------------

  useEffect(() => {
    if (!isActive || !token) return undefined;

    const tick = async () => {
      const fix = latestFixRef.current;
      if (!fix) return;

      // Cancel any in-flight poll so we don't queue up requests if the
      // server is slow.
      if (pollAbortRef.current) pollAbortRef.current.abort();
      const controller = new AbortController();
      pollAbortRef.current = controller;

      const payload = {
        latitude: fix.latitude,
        longitude: fix.longitude,
        speed: fix.speed,
        heading: fix.heading ?? 0,
      };

      try {
        const result = await riskApi.predict(token, payload, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setPollError(null);

        const nextRisk = {
          risk_level: result.risk_level,
          alert_message: result.alert_message,
          risk_score: result.risk_score,
        };
        latestRiskRef.current = nextRisk;
        setRisk(nextRisk);

        // Feed the running average + tag subsequent GPS fixes with the
        // latest 0-1 risk so the saved route carries per-point risk.
        const score01 = clamp01((result.risk_score ?? 0) / 100);
        lastRiskScore01Ref.current = score01;
        riskSumRef.current += score01;
        riskCountRef.current += 1;

        // --- Zone-entry / -exit detection (once per zone, with hysteresis) ---
        const score = result.risk_score ?? 0;
        if (!hazardActiveRef.current && score > HAZARD_ENTER_SCORE) {
          hazardActiveRef.current = true;
          setAlertCount((c) => c + 1);
          setAlertVisible(true);
          speakHazard(result.alert_message);
        } else if (hazardActiveRef.current && score < HAZARD_EXIT_SCORE) {
          hazardActiveRef.current = false;
        }

        applyTrailUpdate(result.risk_level, {
          latitude: fix.latitude,
          longitude: fix.longitude,
        });
      } catch (err) {
        if (err?.name === 'AbortError') return;
        // Friendly wording for common transient upstream failures. The
        // poll keeps running, so we auto-clear the banner a bit later.
        let message;
        if (err instanceof ApiError) {
          if (err.status === 502) {
            message = 'Weather service slow — retrying.';
          } else if (err.status === 503) {
            message = 'Risk engine warming up — retrying.';
          } else if (err.status === 0) {
            message = 'Network lost — retrying.';
          } else {
            message = err.message;
          }
        } else {
          message = 'Risk prediction failed. Retrying…';
        }
        setPollError(message);
        // Auto-hide so the red strip doesn't stick around when the next
        // tick succeeds and clears it anyway.
        setTimeout(() => {
          setPollError((current) => (current === message ? null : current));
        }, 4000);
      }
    };

    // Fire once immediately so the user sees feedback sooner than 3 s.
    tick();
    pollTimerRef.current = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (pollAbortRef.current) {
        pollAbortRef.current.abort();
        pollAbortRef.current = null;
      }
    };
  }, [isActive, token]);

  const applyTrailUpdate = useCallback((riskLevel, coord) => {
    setTrailSegments((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.risk_level === riskLevel) {
        // Same risk level → append to existing segment but hand back a NEW
        // array reference so RiskTrail actually re-renders with fresh
        // coords. Still much cheaper than re-rendering the whole map.
        const updatedSeg = {
          ...last,
          points: [...last.points.slice(-TRAIL_MAX_POINTS_PER_SEGMENT + 1), coord],
        };
        activeSegmentRef.current = updatedSeg;
        const next = prev.slice(0, -1);
        next.push(updatedSeg);
        return next;
      }

      // Risk level changed → start a new segment. Seed it with the previous
      // segment's tail so the colour transition is visually continuous.
      const seed =
        last && last.points.length > 0
          ? [last.points[last.points.length - 1], coord]
          : [coord];
      const newSeg = {
        id: ++segmentIdRef.current,
        risk_level: riskLevel,
        points: seed,
      };
      activeSegmentRef.current = newSeg;
      const next = [...prev, newSeg];
      while (next.length > TRAIL_MAX_SEGMENTS) next.shift();
      return next;
    });
  }, []);

  // ----- Alert modal dismiss --------------------------------------------

  const onDismissAlert = useCallback(() => setAlertVisible(false), []);

  // ----- Rendered HUD ---------------------------------------------------

  const speedKmh = position
    ? Math.round((position.speed || 0) * 3.6)
    : null;

  const statusColor = useMemo(() => {
    if (!risk) return colors.textMuted;
    return RISK_COLORS[risk.risk_level] || colors.textMuted;
  }, [risk]);

  return (
    <View style={styles.container}>
      {MapView ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          provider={PROVIDER_DEFAULT}
          initialRegion={INITIAL_REGION}
          showsCompass={false}
          showsMyLocationButton={false}
          showsUserLocation={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          <RiskTrail segments={trailSegments} />
          <UserMarker
            coordinate={
              position
                ? { latitude: position.latitude, longitude: position.longitude }
                : null
            }
            heading={position?.heading}
          />
        </MapView>
      ) : (
        <View style={styles.webFallback}>
          <Text style={styles.webFallbackText}>
            Map is only available on iOS and Android builds.
          </Text>
        </View>
      )}

      {/* Top status bar (hidden while the alert banner is covering the top half) */}
      {!alertVisible ? (
        <View style={styles.hudTop} pointerEvents="none">
          <View style={[styles.riskPill, { backgroundColor: statusColor }]}>
            <Text style={styles.riskPillText}>
              {risk?.risk_level ? risk.risk_level.toUpperCase() : 'MONITORING'}
              {typeof risk?.risk_score === 'number'
                ? ` · ${Math.round(risk.risk_score)}`
                : ''}
              {alertCount > 0 ? ` · ${alertCount} alert${alertCount === 1 ? '' : 's'}` : ''}
            </Text>
          </View>
          {risk?.alert_message ? (
            <Text style={styles.alertLine} numberOfLines={2}>
              {risk.alert_message}
            </Text>
          ) : null}
          {pollError ? (
            <Text style={styles.errorLine} numberOfLines={2}>
              {pollError}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Speed panel */}
      {speedKmh !== null ? (
        <View style={styles.speedPanel} pointerEvents="none">
          <Text style={styles.speedValue}>{speedKmh}</Text>
          <Text style={styles.speedUnit}>km/h</Text>
        </View>
      ) : null}

      {/* Bottom action bar */}
      <View style={styles.bottomBar}>
        {permissionError ? (
          <Text style={styles.permissionError}>{permissionError}</Text>
        ) : null}
        {!isActive ? (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={startSession}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Start live drive"
          >
            <Ionicons name="play" size={22} color={colors.onPrimary} />
            <Text style={styles.primaryButtonText}>Start Live Drive</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryButton, styles.stopButton]}
            onPress={stopSession}
            disabled={savingTrip}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Stop live drive"
          >
            {savingTrip ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <>
                <Ionicons name="stop" size={22} color={colors.onPrimary} />
                <Text style={styles.primaryButtonText}>Stop & Save Trip</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        {isActive && !risk ? (
          <View style={styles.pollingHint}>
            <ActivityIndicator color={colors.textMuted} />
            <Text style={styles.pollingHintText}>Calculating risk…</Text>
          </View>
        ) : null}
      </View>

      <AlertModal
        visible={alertVisible}
        hazardType={hazardTypeFrom(risk?.alert_message)}
        message={risk?.alert_message}
        riskScore={risk?.risk_score}
        onDismiss={onDismissAlert}
      />
    </View>
  );
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// ---------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  hudTop: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  riskPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  riskPillText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  alertLine: {
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  errorLine: {
    backgroundColor: colors.danger,
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  speedPanel: {
    position: 'absolute',
    right: spacing.md,
    top: 80,
    backgroundColor: colors.background,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  speedValue: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
  },
  speedUnit: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  bottomBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 100,
    alignItems: 'stretch',
  },
  permissionError: {
    marginBottom: spacing.sm,
    padding: spacing.sm,
    color: colors.onPrimary,
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  primaryButton: {
    minHeight: tapTarget,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  stopButton: {
    backgroundColor: colors.danger,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: 17,
    fontWeight: '800',
    marginLeft: spacing.sm,
    letterSpacing: 0.3,
  },
  pollingHint: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  pollingHintText: {
    marginLeft: spacing.xs,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});
