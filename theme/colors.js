// Central design tokens for RoadSense.
// Kept intentionally small so screens stay minimal and readable at a glance
// during driving (high contrast, few accent colors, no decoration).

export const colors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  border: '#E5E7EB',

  text: '#111111',
  textMuted: '#4B5563',
  textSubtle: '#9CA3AF',

  safe: '#2ECC71',
  danger: '#E74C3C',
  primary: '#111111',
  onPrimary: '#FFFFFF',

  inputBackground: '#F5F5F5',
  inputBorder: '#D1D5DB',
  inputBorderFocused: '#111111',

  overlay: 'rgba(0,0,0,0.04)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
};

// Minimum tap target height for in-car use.
export const tapTarget = 56;

export const typography = {
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  heading: { fontSize: 20, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, fontWeight: '500', color: colors.text },
  label: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  caption: { fontSize: 13, fontWeight: '500', color: colors.textSubtle },
};
