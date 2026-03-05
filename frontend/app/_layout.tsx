import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { createContext, useContext, useState, useCallback } from 'react';
import { DarkColors, LightColors, ThemeColors } from '@/src/constants/colors';

type ThemeContextType = {
  isDark: boolean;
  colors: ThemeColors;
  toggle: () => void;
};

export const ThemeContext = createContext<ThemeContextType>({
  isDark: true,
  colors: DarkColors,
  toggle: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export default function RootLayout() {
  const [isDark, setIsDark] = useState(true);
  const colors = isDark ? DarkColors : LightColors;
  const toggle = useCallback(() => setIsDark((prev) => !prev), []);

  return (
    <ThemeContext.Provider value={{ isDark, colors, toggle }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="viewer" />
      </Stack>
    </ThemeContext.Provider>
  );
}
