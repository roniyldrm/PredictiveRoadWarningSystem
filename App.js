import React from 'react';
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
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
import LoginScreen from './screens/LoginScreen';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { colors } from './theme/colors';

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();

function LogoutButton() {
  const { signOut } = useAuth();
  return (
    <TouchableOpacity
      onPress={signOut}
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={styles.logoutButton}
      activeOpacity={0.7}
    >
      <Ionicons name="log-out-outline" size={22} color={colors.text} />
      <Text style={styles.logoutLabel}>Sign out</Text>
    </TouchableOpacity>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTitleStyle: {
          color: colors.text,
          fontSize: 17,
          fontWeight: '700',
        },
        headerShadowVisible: false,
        headerRight: () => <LogoutButton />,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 0,
          height: 70,
          paddingTop: 8,
          paddingBottom: 10,
          paddingHorizontal: 10,
          position: 'absolute',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.08,
          shadowRadius: 12,
          elevation: 20,
        },
        tabBarActiveTintColor: '#2196F3',
        tabBarInactiveTintColor: '#9E9E9E',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
          marginBottom: 4,
        },
      }}
    >
      <Tab.Screen
        name="LiveDrive"
        component={LiveDriveScreen}
        options={{
          title: 'Live Drive',
          tabBarLabel: 'Live Drive',
          tabBarIcon: ({ color, focused }) => (
            <View
              style={{
                backgroundColor: focused ? '#E3F2FD' : 'transparent',
                padding: 8,
                borderRadius: 12,
              }}
            >
              <MaterialCommunityIcons
                name="navigation-variant"
                size={24}
                color={color}
              />
            </View>
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
            <View
              style={{
                backgroundColor: focused ? '#FFEBEE' : 'transparent',
                padding: 8,
                borderRadius: 12,
              }}
            >
              <Ionicons
                name="warning"
                size={24}
                color={focused ? '#D32F2F' : color}
              />
            </View>
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
            <View
              style={{
                backgroundColor: focused ? '#E3F2FD' : 'transparent',
                padding: 8,
                borderRadius: 12,
              }}
            >
              <Ionicons name="time" size={24} color={color} />
            </View>
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
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    minHeight: 48,
  },
  logoutLabel: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
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
