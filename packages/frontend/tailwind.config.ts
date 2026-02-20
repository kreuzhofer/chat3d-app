import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        card: "hsl(var(--card))",
        border: "hsl(var(--border))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        destructive: "hsl(var(--destructive))",
        "destructive-foreground": "hsl(var(--destructive-foreground))",
        success: "hsl(var(--success))",
        "success-foreground": "hsl(var(--success-foreground))",
        warning: "hsl(var(--warning))",
        "warning-foreground": "hsl(var(--warning-foreground))",
        info: "hsl(var(--info))",
        "info-foreground": "hsl(var(--info-foreground))",
        accent: "hsl(var(--accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        "surface-1": "hsl(var(--surface-1))",
        "surface-2": "hsl(var(--surface-2))",
        "surface-3": "hsl(var(--surface-3))",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      animation: {
        "fade-in": "fadeIn var(--duration-normal) var(--ease-out)",
        "fade-out": "fadeOut var(--duration-normal) var(--ease-out)",
        "slide-in-right": "slideInFromRight var(--duration-normal) var(--ease-out)",
        "slide-out-right": "slideOutToRight var(--duration-normal) var(--ease-out)",
        "slide-in-left": "slideInFromLeft var(--duration-normal) var(--ease-out)",
        "slide-in-bottom": "slideInFromBottom var(--duration-normal) var(--ease-out)",
        "slide-out-bottom": "slideOutToBottom var(--duration-fast) var(--ease-in-out)",
        "scale-in": "scaleIn var(--duration-normal) var(--ease-out)",
        shimmer: "shimmer 1.5s infinite linear",
        spin: "spin 1s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
