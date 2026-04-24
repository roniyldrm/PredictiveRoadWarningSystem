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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { riskApi, historyApi, ApiError } from '../api/client';
import AlertModal from '../components/AlertModal';
import RiskTrail, { RISK_COLORS } from '../components/RiskTrail';
import TripSummaryModal from '../components/TripSummaryModal';
import { hazardTypeFrom, voicePhraseFor } from '../lib/hazard';
import { recommendFor } from '../lib/recommendations';
import {
  colors,
  spacing,
  radius,
  tapTarget,
  typography,
  elevation,
} from '../theme/colors';

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

// Dark Google Maps style for night mode. Applied via MapView's
// `customMapStyle` on Android; silently ignored on iOS (Apple Maps).
const NIGHT_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
];

// ---------------------------------------------------------------------
// Isolated user marker — only this subtree re-renders on each GPS tick.
//
// If we know the driver's heading, we render a navigation arrow that
// tracks the travel direction (flat + rotation from the GPS heading).
// When heading is unknown (no movement yet) we fall back to a plain
// circle so the marker still shows the exact fix.
// ---------------------------------------------------------------------
const UserMarker = React.memo(function UserMarker({ coordinate, heading }) {
  if (!Marker || !coordinate) return null;
  const hasHeading = Number.isFinite(heading) && heading >= 0 && heading <= 360;
  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      flat
      rotation={hasHeading ? heading : 0}
      tracksViewChanges={false}
    >
      <View style={markerStyles.halo}>
        {hasHeading ? (
          <View style={markerStyles.arrowBody}>
            <MaterialCommunityIcons
              name="navigation"
              size={26}
              color={colors.onPrimary}
            />
          </View>
        ) : (
          <View style={markerStyles.dotBody} />
        )}
      </View>
    </Marker>
  );
});

const markerStyles = StyleSheet.create({
  halo: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(99, 102, 241, 0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowBody: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: colors.background,
    alignItems: 'center',
    // Shift the icon up a touch inside the circle so the arrow tip sits
    // near the top edge of the disc — feels more like a compass needle.
    paddingTop: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  dotBody: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accent,
    borderWidth: 4,
    borderColor: colors.background,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
});

// ---------------------------------------------------------------------

export default function LiveDriveScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

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
  // Day / night map theme toggle — shows sun or moon icon.
  const [isNightMode, setIsNightMode] = useState(false);
  // Post-trip summary modal data (null when not visible).
  const [tripSummary, setTripSummary] = useState(null);

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
    // Snapshot all session data BEFORE teardown resets state, so we can
    // both POST the trip and hand the numbers to the summary modal.
    const startedAt = sessionStartRef.current;
    const endedAt = new Date();
    // Downsample before POST: a 30 min trip at 1 Hz is 1 800 points
    // (~300 KB JSON) which some tunnels / proxies truncate with 503.
    // 200 evenly-spaced points are plenty for the heatmap + history view.
    const routePoints = downsampleRoute(routeRef.current, 200);
    const avg01 =
      riskCountRef.current > 0
        ? riskSumRef.current / riskCountRef.current
        : 0;
    const alerts = alertCount;
    const conditionsSnapshot = latestRiskRef.current?.conditions ?? null;

    // Aggregate post-trip metrics (distance + peak risk + max speed).
    const distanceKm = haversineDistanceKm(routePoints);
    const durationMinutes =
      startedAt ? (endedAt.getTime() - startedAt.getTime()) / 60000 : null;
    const peakRisk = routePoints.reduce(
      (acc, p) => (typeof p.r_total === 'number' ? Math.max(acc, p.r_total) : acc),
      0,
    );
    const maxSpeedKmh = routePoints.reduce(
      (acc, p) => (typeof p.speed_kmh === 'number' ? Math.max(acc, p.speed_kmh) : acc),
      0,
    );

    const summary = {
      startedAt,
      endedAt,
      durationMinutes,
      distanceKm,
      avgRisk: clamp01(avg01),
      peakRisk: clamp01(peakRisk),
      alertCount: alerts,
      maxSpeedKmh,
      conditions: conditionsSnapshot,
      saved: null,         // null = still saving; true / false after POST
      saveError: null,
    };

    teardownSession();

    if (!token || !startedAt || routePoints.length === 0) {
      // Still show a summary for instant feedback — just flag it unsaved.
      setTripSummary({ ...summary, saved: false });
      return;
    }

    setSavingTrip(true);
    // Show modal optimistically so the user sees their stats immediately.
    setTripSummary({ ...summary, saved: null });
    try {
      await historyApi.create(token, {
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        route: routePoints,
        average_r_total: clamp01(avg01),
        alert_count: alerts,
      });
      setTripSummary((s) => (s ? { ...s, saved: true } : s));
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.message : 'Please try again.';
      setPollError(`Trip not saved: ${detail}`);
      setTripSummary((s) =>
        s ? { ...s, saved: false, saveError: detail } : s,
      );
    } finally {
      setSavingTrip(false);
    }
  }, [alertCount, teardownSession, token]);

  const onDismissSummary = useCallback(() => setTripSummary(null), []);

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

  const speakHazard = useCallback((message, riskLevel) => {
    // Fire-and-forget. expo-speech uses the platform TTS engine:
    //   iOS:     AVSpeechSynthesizer — respects the ringer silent switch
    //            (media category), so "Silent Mode" mutes the warning.
    //   Android: plays through the music stream, honouring the user's
    //            media volume; it does NOT observe "Do Not Disturb".
    // We stop any currently speaking utterance first so overlapping zone
    // entries can't queue up.
    try {
      Speech.stop();
      Speech.speak(voicePhraseFor(hazardTypeFrom(message, riskLevel)), {
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
          speakHazard(result.alert_message, result.risk_level);
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
          // Android (Google Maps) honors customMapStyle. iOS (Apple Maps)
          // ignores it silently, so night mode there just toggles the
          // button state — still useful for a consistent UI.
          customMapStyle={isNightMode ? NIGHT_MAP_STYLE : []}
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
        <View
          style={[styles.hudTop, { top: insets.top + spacing.sm }]}
          pointerEvents="none"
        >
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
      {speedKmh !== null && !alertVisible ? (
        <View
          style={[styles.speedPanel, { top: insets.top + 76 }]}
          pointerEvents="none"
        >
          <Text style={styles.speedValue}>{speedKmh}</Text>
          <Text style={styles.speedUnit}>km/h</Text>
        </View>
      ) : null}

      {/* Day / Night toggle — top-right, offset below the speed panel */}
      {!alertVisible ? (
        <TouchableOpacity
          style={[
            styles.mapThemeToggle,
            {
              top:
                insets.top +
                (speedKmh !== null ? 76 + 72 : 76),
            },
          ]}
          onPress={() => setIsNightMode((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={
            isNightMode ? 'Switch to day map' : 'Switch to night map'
          }
          activeOpacity={0.85}
        >
          <Ionicons
            name={isNightMode ? 'sunny' : 'moon'}
            size={22}
            color={colors.text}
          />
        </TouchableOpacity>
      ) : null}

      {/* Bottom action bar — keeps clear of tab bar + phone gesture bar */}
      <View style={[styles.bottomBar, { bottom: 70 + Math.max(insets.bottom, 16) + 16 }]}>
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
        hazardType={hazardTypeFrom(risk?.alert_message, risk?.risk_level)}
        message={risk?.alert_message}
        riskScore={risk?.risk_score}
        onDismiss={onDismissAlert}
      />

      <TripSummaryModal
        visible={tripSummary != null}
        summary={tripSummary}
        recommendation={tripSummary ? recommendFor(tripSummary) : null}
        onDismiss={onDismissSummary}
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

// Evenly-stride a route down to at most `maxPoints`, always keeping the
// first and last samples so the displayed line doesn't visually shrink
// at the ends.
function downsampleRoute(points, maxPoints) {
  if (!Array.isArray(points) || points.length <= maxPoints) {
    return points ? points.slice() : [];
  }
  const step = (points.length - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(points[Math.round(i * step)]);
  }
  // Guarantee the final fix is included as-is (already will be for
  // integer `step` but float drift can clip it).
  out[out.length - 1] = points[points.length - 1];
  return out;
}

// Haversine great-circle distance in kilometres over a list of
// {latitude, longitude} points. Returns 0 for <2 valid points.
function haversineDistanceKm(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  const R_KM = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (
      typeof a?.latitude !== 'number' ||
      typeof a?.longitude !== 'number' ||
      typeof b?.latitude !== 'number' ||
      typeof b?.longitude !== 'number'
    ) {
      continue;
    }
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    total += 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  return total;
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
    left: spacing.md,
    right: spacing.md,
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  riskPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    ...elevation.md,
  },
  riskPillText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  alertLine: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...elevation.sm,
  },
  errorLine: {
    backgroundColor: colors.danger,
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...elevation.sm,
  },
  speedPanel: {
    position: 'absolute',
    right: spacing.md,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 88,
    ...elevation.md,
  },
  mapThemeToggle: {
    position: 'absolute',
    right: spacing.md,
    width: 48,
    height: 48,
    marginTop: -140,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.md,
  },
  speedValue: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -1,
  },
  speedUnit: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSubtle,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  bottomBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    // `bottom` is set dynamically at the use-site based on safe-area insets
    // (tab bar is 70px, then we lift by inset + a fixed margin).
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
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    ...elevation.lg,
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
