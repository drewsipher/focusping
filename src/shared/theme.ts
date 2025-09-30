export const theme = {
  colors: {
    gradientLightStart: "#f97316",
    gradientLightEnd: "#6366f1",
    gradientDarkStart: "#0ea5e9",
    gradientDarkEnd: "#6366f1",
    surfaceLight: "rgba(255, 255, 255, 0.92)",
    surfaceDark: "rgba(15, 23, 42, 0.9)",
    textPrimary: "#111827",
    textSecondary: "#1f2933",
    textOnDark: "#f9fafb",
    buttonDark: "#111827",
    buttonLight: "#f9fafb",
    link: "#0f172a",
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
  },
  radii: {
    pill: 999,
    medium: 12,
  },
  shadows: {
    elevated: "0 16px 30px rgba(15, 23, 42, 0.2)",
    hover: "0 10px 18px rgba(15, 23, 42, 0.25)",
  },
  transitions: {
    quick: "150ms ease",
  },
};

export type Theme = typeof theme;
