import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  ScrollView,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';

export default function AlertSimulationScreen() {
  const [alertState, setAlertState] = useState('alert');
  const [pulseAnim] = useState(new Animated.Value(1));
  const [fadeAnim] = useState(new Animated.Value(1));

  // Mock alert data - this would come from FastAPI backend
  const alertData = {
    riskScore: 0.87,
    location: {
      road: 'E-5 Highway',
      segment: 'KM 42.3',
      coordinates: '41.0082° N, 28.9784° E',
    },
    riskFactors: {
      historical: { value: 0.45, description: 'High accident frequency zone' },
      weather: { value: 0.72, description: 'Heavy rain detected' },
      temporal: { value: 0.38, description: 'Evening rush hour' },
    },
    hazards: [
      { type: 'weather', icon: 'weather-pouring', label: 'Heavy Rain', severity: 'high' },
      { type: 'road', icon: 'road-variant', label: 'Sharp Curve Ahead', severity: 'medium' },
      { type: 'visibility', icon: 'eye-off', label: 'Reduced Visibility', severity: 'medium' },
    ],
    suggestion: {
      action: 'Reduce Speed',
      targetSpeed: 50,
      currentSpeed: 72,
    },
    historicalData: {
      accidentsLast5Years: 23,
      fatalityRate: '8.7%',
      commonCause: 'Weather + Speeding',
    },
  };

  useEffect(() => {
    if (alertState === 'alert') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [alertState]);

  const handleAcknowledge = () => {
    setAlertState('acknowledged');
    setTimeout(() => {
      setAlertState('monitoring');
      setTimeout(() => setAlertState('alert'), 4000);
    }, 2500);
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return '#D32F2F';
      case 'medium': return '#FF9800';
      case 'low': return '#4CAF50';
      default: return '#666';
    }
  };

  // ALERT STATE
  const renderAlertState = () => (
    <ScrollView style={styles.alertScroll} contentContainerStyle={styles.alertScrollContent}>
      {/* Danger Header */}
      <View style={styles.dangerHeader}>
        <Animated.View style={[styles.warningIconOuter, { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.warningIconInner}>
            <Ionicons name="warning" size={44} color="#FFF" />
          </View>
        </Animated.View>
        <Text style={styles.dangerTitle}>HIGH RISK DETECTED</Text>
        <Text style={styles.dangerLocation}>
          <Ionicons name="location" size={14} color="rgba(255,255,255,0.8)" /> {alertData.location.road}, {alertData.location.segment}
        </Text>
      </View>

      {/* Risk Score Card */}
      <View style={styles.contentContainer}>
        <View style={styles.scoreCard}>
          <View style={styles.scoreHeader}>
            <Text style={styles.scoreLabel}>CALCULATED RISK SCORE</Text>
            <Text style={styles.scoreFormula}></Text>
          </View>
          <View style={styles.scoreDisplay}>
            <Text style={styles.scoreValue}>{(alertData.riskScore * 100).toFixed(0)}</Text>
            <Text style={styles.scorePercent}>%</Text>
          </View>
          <View style={styles.scoreBar}>
            <View style={[styles.scoreBarFill, { width: `${alertData.riskScore * 100}%` }]} />
            <View style={[styles.scoreThreshold, { left: '30%' }]} />
            <View style={[styles.scoreThreshold, { left: '70%' }]} />
          </View>
          <View style={styles.scoreLabels}>
            <Text style={styles.scoreLabelText}>Low</Text>
            <Text style={styles.scoreLabelText}>Medium</Text>
            <Text style={styles.scoreLabelText}>High</Text>
          </View>
        </View>

        {/* Risk Factor Breakdown
        <View style={styles.breakdownCard}>
          <Text style={styles.sectionTitle}>Risk Factor Breakdown</Text>
          
          <View style={styles.factorRow}>
            <View style={styles.factorLeft}>
              <MaterialCommunityIcons name="map-marker-alert" size={20} color="#E53935" />
              <View style={styles.factorInfo}>
                <Text style={styles.factorName}>H(loc) - Historical</Text>
                <Text style={styles.factorDesc}>{alertData.riskFactors.historical.description}</Text>
              </View>
            </View>
            <Text style={styles.factorValue}></Text>
          </View>

          <View style={styles.factorRow}>
            <View style={styles.factorLeft}>
              <MaterialCommunityIcons name="weather-pouring" size={20} color="#2196F3" />
              <View style={styles.factorInfo}>
                <Text style={styles.factorName}>W(t) - Weather</Text>
                <Text style={styles.factorDesc}>{alertData.riskFactors.weather.description}</Text>
              </View>
            </View>
            <Text style={[styles.factorValue, { color: '#D32F2F' }]}></Text>
          </View>

          <View style={styles.factorRow}>
            <View style={styles.factorLeft}>
              <Ionicons name="time" size={20} color="#FF9800" />
              <View style={styles.factorInfo}>
                <Text style={styles.factorName}>T(t) - Temporal</Text>
                <Text style={styles.factorDesc}>{alertData.riskFactors.temporal.description}</Text>
              </View>
            </View>
            <Text style={styles.factorValue}></Text>
          </View>
        </View> */}

        {/* Detected Hazards */}
        <View style={styles.hazardsCard}>
          <Text style={styles.sectionTitle}>Detected Hazards</Text>
          <View style={styles.hazardsList}>
            {alertData.hazards.map((hazard, index) => (
              <View key={index} style={styles.hazardItem}>
                <View style={[styles.hazardIcon, { backgroundColor: `${getSeverityColor(hazard.severity)}15` }]}>
                  <MaterialCommunityIcons name={hazard.icon} size={22} color={getSeverityColor(hazard.severity)} />
                </View>
                <Text style={styles.hazardLabel}>{hazard.label}</Text>
                <View style={[styles.severityDot, { backgroundColor: getSeverityColor(hazard.severity) }]} />
              </View>
            ))}
          </View>
        </View>

        {/* Historical Context */}
        {/* <View style={styles.historyCard}>
          <Text style={styles.sectionTitle}>Historical Data (This Segment)</Text>
          <View style={styles.historyGrid}>
            <View style={styles.historyItem}>
              <Text style={styles.historyValue}>{alertData.historicalData.accidentsLast5Years}</Text>
              <Text style={styles.historyLabel}>Accidents (5yr)</Text>
            </View>
            <View style={styles.historyItem}>
              <Text style={[styles.historyValue, { color: '#D32F2F' }]}>{alertData.historicalData.fatalityRate}</Text>
              <Text style={styles.historyLabel}>Fatality Rate</Text>
            </View>
            <View style={styles.historyItem}>
              <Text style={styles.historyValueSmall}>{alertData.historicalData.commonCause}</Text>
              <Text style={styles.historyLabel}>Common Cause</Text>
            </View>
          </View>
        </View> */}

        {/* Recommendation */}
        <View style={styles.recommendCard}>
          <View style={styles.recommendHeader}>
            <MaterialCommunityIcons name="lightbulb-on" size={24} color="#FF9800" />
            <Text style={styles.recommendTitle}>RECOMMENDED ACTION</Text>
          </View>
          <View style={styles.speedRecommend}>
            <View style={styles.speedCurrent}>
              <Text style={styles.speedLabel}>Current</Text>
              <Text style={styles.speedNum}>{alertData.suggestion.currentSpeed}</Text>
              <Text style={styles.speedKmh}>km/h</Text>
            </View>
            <Ionicons name="arrow-forward" size={28} color="#666" />
            <View style={styles.speedTarget}>
              <Text style={styles.speedLabel}>Target</Text>
              <Text style={[styles.speedNum, { color: '#4CAF50' }]}>{alertData.suggestion.targetSpeed}</Text>
              <Text style={styles.speedKmh}>km/h</Text>
            </View>
          </View>
        </View>

        {/* Acknowledge Button */}
        <TouchableOpacity style={styles.acknowledgeBtn} onPress={handleAcknowledge} activeOpacity={0.9}>
          <Ionicons name="shield-checkmark" size={22} color="#FFF" />
          <Text style={styles.acknowledgeBtnText}>I Understand - Proceed Safely</Text>
        </TouchableOpacity>

        <View style={{ height: 120 }} />
      </View>
    </ScrollView>
  );

  // ACKNOWLEDGED STATE
  const renderAcknowledgedState = () => (
    <View style={styles.acknowledgedContainer}>
      <View style={styles.checkCircle}>
        <Ionicons name="checkmark" size={60} color="#4CAF50" />
      </View>
      <Text style={styles.acknowledgedTitle}>Alert Acknowledged</Text>
      <Text style={styles.acknowledgedSubtitle}>Proceed with caution</Text>
      <View style={styles.speedReminderCard}>
        <MaterialCommunityIcons name="speedometer-slow" size={32} color="#FF9800" />
        <View style={styles.speedReminderText}>
          <Text style={styles.speedReminderLabel}>Maintain safe speed</Text>
          <Text style={styles.speedReminderValue}>≤ 50 km/h recommended</Text>
        </View>
      </View>
    </View>
  );

  // MONITORING STATE (Safe)
  const renderMonitoringState = () => (
    <View style={styles.safeContainer}>
      <View style={styles.safeHeader}>
        <Text style={styles.safeHeaderTitle}>Alert Simulation</Text>
        <Text style={styles.safeHeaderSubtitle}>Demonstrating the Predictive Road Warning System</Text>
      </View>
      <View style={styles.safeContent}>
        <View style={styles.safeIconCircle}>
          <Ionicons name="shield-checkmark" size={64} color="#4CAF50" />
        </View>
        <Text style={styles.safeTitle}>No Active Alerts</Text>
        <Text style={styles.safeSubtitle}>Road conditions are within safe parameters</Text>
        
        <View style={styles.infoBox}>
          <Feather name="info" size={18} color="#2196F3" />
          <Text style={styles.infoText}>
            This screen simulates how the app displays real-time risk alerts when the AI model detects dangerous conditions.
          </Text>
        </View>

        <Text style={styles.demoTimer}>Demo alert appearing in 4 seconds...</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle={alertState === 'alert' ? 'light-content' : 'dark-content'} />
      {alertState === 'alert' && renderAlertState()}
      {alertState === 'acknowledged' && renderAcknowledgedState()}
      {alertState === 'monitoring' && renderMonitoringState()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  // Alert State
  alertScroll: {
    flex: 1,
    backgroundColor: '#C62828',
  },
  alertScrollContent: {
    paddingBottom: 40,
  },
  dangerHeader: {
    backgroundColor: '#C62828',
    paddingTop: 70,
    paddingBottom: 30,
    alignItems: 'center',
  },
  warningIconOuter: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  warningIconInner: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dangerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFF',
    marginTop: 16,
    letterSpacing: 1,
  },
  dangerLocation: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 8,
  },
  contentContainer: {
    backgroundColor: '#F5F7FA',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -16,
    padding: 20,
  },
  scoreCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  scoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  scoreLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
    letterSpacing: 0.5,
  },
  scoreFormula: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#999',
  },
  scoreDisplay: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginBottom: 16,
  },
  scoreValue: {
    fontSize: 56,
    fontWeight: '800',
    color: '#C62828',
  },
  scorePercent: {
    fontSize: 24,
    fontWeight: '700',
    color: '#C62828',
    marginBottom: 10,
    marginLeft: 2,
  },
  scoreBar: {
    height: 10,
    backgroundColor: '#E0E0E0',
    borderRadius: 5,
    overflow: 'visible',
    position: 'relative',
  },
  scoreBarFill: {
    height: '100%',
    backgroundColor: '#C62828',
    borderRadius: 5,
  },
  scoreThreshold: {
    position: 'absolute',
    top: -2,
    width: 2,
    height: 14,
    backgroundColor: '#666',
  },
  scoreLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  scoreLabelText: {
    fontSize: 10,
    color: '#999',
  },
  breakdownCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#333',
    marginBottom: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  factorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  factorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  factorInfo: {
    marginLeft: 12,
  },
  factorName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  factorDesc: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  factorValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  hazardsCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  hazardsList: {
    gap: 10,
  },
  hazardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FAFAFA',
    borderRadius: 10,
  },
  hazardIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hazardLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginLeft: 12,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  historyCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  historyGrid: {
    flexDirection: 'row',
  },
  historyItem: {
    flex: 1,
    alignItems: 'center',
  },
  historyValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
  },
  historyValueSmall: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },
  historyLabel: {
    fontSize: 10,
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
  },
  recommendCard: {
    backgroundColor: '#FFF8E1',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  recommendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  recommendTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F57C00',
    marginLeft: 8,
    letterSpacing: 0.5,
  },
  speedRecommend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  speedCurrent: {
    alignItems: 'center',
  },
  speedTarget: {
    alignItems: 'center',
  },
  speedLabel: {
    fontSize: 11,
    color: '#999',
  },
  speedNum: {
    fontSize: 32,
    fontWeight: '800',
    color: '#333',
  },
  speedKmh: {
    fontSize: 12,
    color: '#666',
  },
  acknowledgeBtn: {
    backgroundColor: '#C62828',
    borderRadius: 14,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#C62828',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  acknowledgeBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
    marginLeft: 10,
  },
  // Acknowledged State
  acknowledgedContainer: {
    flex: 1,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  checkCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
    marginBottom: 24,
  },
  acknowledgedTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#2E7D32',
  },
  acknowledgedSubtitle: {
    fontSize: 16,
    color: '#4CAF50',
    marginTop: 8,
  },
  speedReminderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 20,
    borderRadius: 16,
    marginTop: 30,
  },
  speedReminderText: {
    marginLeft: 16,
  },
  speedReminderLabel: {
    fontSize: 14,
    color: '#666',
  },
  speedReminderValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginTop: 2,
  },
  // Safe/Monitoring State
  safeContainer: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  safeHeader: {
    backgroundColor: '#FFF',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  safeHeaderTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#333',
  },
  safeHeaderSubtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  safeContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
    paddingBottom: 120,
  },
  safeIconCircle: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  safeTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#333',
  },
  safeSubtitle: {
    fontSize: 15,
    color: '#666',
    marginTop: 8,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#E3F2FD',
    padding: 16,
    borderRadius: 12,
    marginTop: 30,
    marginHorizontal: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#1976D2',
    marginLeft: 12,
    lineHeight: 20,
  },
  demoTimer: {
    fontSize: 13,
    color: '#999',
    marginTop: 30,
  },
});
