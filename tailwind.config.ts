import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand surface scale. Teal-tinted rather than neutral grey, pulled
        // from the sponsor artwork: 950 is the deck background (#001117) and
        // 900 the raised panel (#041B22). Retinting this scale rather than
        // renaming it means every existing screen picks up the brand without
        // touching a single component.
        graphite: {
          950: "#001117",
          900: "#041B22",
          850: "#07222B",
          800: "#0B2C36",
          700: "#123843",
          600: "#1C4752",
          // 400 carries nav labels and secondary text everywhere, so it is set
          // by contrast rather than by eye: #5C676B (sampled from the artwork)
          // measured 3.04:1 on the panel and fails WCAG AA for small text.
          // #7C8C91 measures 5.08:1. The sampled value moved down to 500, where
          // it is used for borders and dim figures rather than for reading.
          500: "#5C676B",
          400: "#7C8C91",
          300: "#8A9A9E",
          200: "#ACB2B4",
          100: "#EDF5F5"
        },
        // Primary action and attention. The brand orange, sampled from the
        // artwork (#FF9900), replacing the previous #FF5A1F.
        signal: {
          DEFAULT: "#FF9900",
          dim: "#B36B00",
          bright: "#FFB03D"
        },
        // Brand turquoise. Secondary accent — section rules, logo gradient
        // start, and anything that pairs with signal.
        brand: {
          teal: "#3CD7C5",
          tealDim: "#1F9C8E",
          orange: "#FF9900",
          // Logo gradient endpoints, for surfaces that echo the mark.
          gradFrom: "#4EDAC1",
          gradTo: "#FA9306"
        },
        // Earned progress, and nothing else uses it. Kept lime rather than
        // moved to the brand turquoise so XP stays visually distinct from
        // ordinary brand chrome — otherwise a progress figure reads as just
        // another accent.
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
