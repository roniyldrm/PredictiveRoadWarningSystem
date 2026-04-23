import React from 'react';
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import LiveDriveScreen from './screens/LiveDriveScreen';
import AlertSimulationScreen from './screens/AlertSimulationScreen';
import HistoryScreen from './screens/HistoryScreen';
import AccountScreen from './screens/AccountScreen';
import LoginScreen from './screens/LoginScreen';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { colors, elevation } from './theme/colors';

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();

function TabIconPill({ focused, children, tint }) {
  return (
    <View
      style={{
        backgroundColor: focused ? tint : 'transparent',
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 40,
      }}
    >
      {children}
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTitleStyle: {
          color: colors.text,
          fontSize: 17,
          fontWeight: '800',
        },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopWidth: 0,
          height: 72,
          paddingTop: 6,
          paddingBottom: 10,
          // No horizontal padding — each tab gets flex:1 of the full width
          // so 4 tabs fit even on narrow devices without clipping icons.
          paddingHorizontal: 0,
          position: 'absolute',
          ...elevation.lg,
        },
        tabBarItemStyle: {
          paddingHorizontal: 0,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginTop: 2,
          marginBottom: 4,
          letterSpacing: 0.1,
        },
        tabBarAllowFontScaling: false,
      }}
    >
      <Tab.Screen
        name="LiveDrive"
        component={LiveDriveScreen}
        options={{
          title: 'Live Drive',
          tabBarLabel: 'Live',
          headerShown: false,
          tabBarIcon: ({ color, focused }) => (
            <TabIconPill focused={focused} tint={colors.accentTint}>
              <MaterialCommunityIcons
                name="navigation-variant"
                size={22}
                color={color}
              />
            </TabIconPill>
          ),
        }}
      />
      <Tab.Screen
        name="AlertSimulation"
        component={AlertSimulationScreen}
        options={{
          title: 'Alerts',
          tabBarLabel: 'Alerts',
          tabBarIcon: ({ color, focused }) => (
            <TabIconPill focused={focused} tint={colors.dangerTint}>
              <Ionicons
                name="warning"
                size={22}
                color={focused ? colors.danger : color}
              />
            </TabIconPill>
          ),
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{
          title: 'History',
          tabBarLabel: 'History',
          tabBarIcon: ({ color, focused }) => (
            <TabIconPill focused={focused} tint={colors.safeTint}>
              <Ionicons
                name="time-outline"
                size={22}
                color={focused ? colors.safe : color}
              />
            </TabIconPill>
          ),
        }}
      />
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        options={{
          title: 'Account',
          tabBarLabel: 'Account',
          tabBarIcon: ({ color, focused }) => (
            <TabIconPill focused={focused} tint={colors.accentTint}>
              <Ionicons
                name="person-circle-outline"
                size={22}
                color={color}
              />
            </TabIconPill>
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function BootScreen() {
  return (
    <View style={styles.bootContainer}>
      <ActivityIndicator size="large" color={colors.text} />
      <Text style={styles.bootLabel}>Loading…</Text>
    </View>
  );
}

function RootNavigator() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return <BootScreen />;
  }

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated ? (
        <RootStack.Screen name="Main" component={MainTabs} />
      ) : (
        <RootStack.Screen name="Login" component={LoginScreen} />
      )}
    </RootStack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  bootContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  bootLabel: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
});
