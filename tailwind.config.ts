import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: "#0A0C0E",
          900: "#111417",
          850: "#161A1E",
          800: "#1C2126",
          700: "#262C33",
          600: "#343C44",
          500: "#4A545D",
          400: "#6B767F",
          300: "#98A2AA",
          200: "#C4CBD1",
          100: "#E4E8EB"
        },
        signal: {
          DEFAULT: "#FF5A1F",
          dim: "#B33F13",
          bright: "#FF7A45"
        },
        volt: "#C7FF3D",
        telemetry: {
          blue: "#3DA9FC",
          amber: "#FFB020",
          red: "#FF3B3B",
          green: "#2ED573"
        }
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        sans: ["'Inter'", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.5)"
      }
    }
  },
  plugins: []
};
export default config;
