// Design tokens for RoadSense.
//
// Palette preserves the product constraints:
//   - main background white (#FFFFFF)
//   - safe #2ECC71
//   - danger #E74C3C
// Around those we add a modern neutral scale (slate-based), soft tinted
// backgrounds for status cards, a small indigo accent for secondary calls
// to action, and elevation tokens for cards. Nothing decorative — just
// enough depth so the UI stops looking like a Word document.

import { Platform } from 'react-native';

export const colors = {
  // Surfaces
  background: '#FFFFFF',
  backgroundMuted: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceAlt: '#F3F4F6',
  overlay: 'rgba(15, 23, 42, 0.04)',

  // Borders
  border: '#E5E7EB',
  borderSoft: '#F1F3F5',

  // Text (slate scale — softer than pure black/grey)
  text: '#0F172A',
  textMuted: '#475569',
  textSubtle: '#94A3B8',

  // Brand / primary CTA
  primary: '#0F172A',
  primaryHover: '#1E293B',
  onPrimary: '#FFFFFF',

  // Secondary accent (used sparingly — info, active tab)
  accent: '#6366F1',
  accentTint: '#EEF2FF',

  // Status — preserved product colors + matching soft tints
  safe: '#2ECC71',
  safeTint: '#E8F9EF',
  warn: '#F59E0B',
  warnTint: '#FEF5E6',
  danger: '#E74C3C',
  dangerTint: '#FDECE9',

  // Inputs
  inputBackground: '#F3F4F6',
  inputBorder: '#D1D5DB',
  inputBorderFocused: '#0F172A',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

// Minimum tap target for in-car use.
export const tapTarget = 56;

export const typography = {
  display: { fontSize: 32, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.2 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, fontWeight: '500', color: colors.text },
  bodyMuted: { fontSize: 16, fontWeight: '500', color: colors.textMuted },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSubtle,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  caption: { fontSize: 13, fontWeight: '500', color: colors.textSubtle },
};

// Elevation presets. On iOS we use shadow*; on Android, `elevation`.
// A helper avoids repeating the same object all over the codebase.
export const elevation = {
  sm: Platform.select({
    ios: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    },
    android: { elevation: 2 },
    default: {},
  }),
  md: Platform.select({
    ios: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 5 },
    default: {},
  }),
  lg: Platform.select({
    ios: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.14,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
    },
    android: { elevation: 10 },
    default: {},
  }),
};
