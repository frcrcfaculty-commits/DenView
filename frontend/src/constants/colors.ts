export type ThemeColors = {
  background: string;
  surface: string;
  surfaceHighlight: string;
  primary: string;
  primaryForeground: string;
  accent: string;
  destructive: string;
  muted: string;
  border: string;
  text: string;
  textSecondary: string;
  overlay: string;
  success: string;
};

export const DarkColors: ThemeColors = {
  background: '#09090b',
  surface: '#18181b',
  surfaceHighlight: '#27272a',
  primary: '#06b6d4',
  primaryForeground: '#ffffff',
  accent: '#22d3ee',
  destructive: '#ef4444',
  muted: '#71717a',
  border: '#27272a',
  text: '#fafafa',
  textSecondary: '#a1a1aa',
  overlay: 'rgba(9, 9, 11, 0.85)',
  success: '#10b981',
};

export const LightColors: ThemeColors = {
  background: '#fafafa',
  surface: '#ffffff',
  surfaceHighlight: '#f4f4f5',
  primary: '#0891b2',
  primaryForeground: '#ffffff',
  accent: '#06b6d4',
  destructive: '#ef4444',
  muted: '#a1a1aa',
  border: '#e4e4e7',
  text: '#18181b',
  textSecondary: '#71717a',
  overlay: 'rgba(250, 250, 250, 0.85)',
  success: '#059669',
};
