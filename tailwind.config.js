/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./{app,components,lib,pages,hooks}/**/*.{html,js,ts,jsx,tsx}"],
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        canvas: "var(--app-canvas)",
        surface: {
          DEFAULT: "var(--app-surface)",
          raised: "var(--app-surface-raised)",
          hover: "var(--app-surface-hover)",
          active: "var(--app-surface-active)",
          black: "var(--app-canvas)",
        },
        border: {
          subtle: "var(--app-border-subtle)",
          default: "var(--app-border)",
          strong: "var(--app-border-strong)",
          focus: "#3b82f6",
        },
        action: {
          primary: "#3b82f6",
          hover: "#60a5fa",
          text: "#071a31",
        },
        status: {
          checked: "#34d399",
          waiting: "#d5b479",
          danger: "#fb7185",
        },
        text: {
          muted: "var(--app-text-muted)",
          dim: "#99999f",
          body: "var(--app-text-body)",
          heading: "var(--app-text)",
        }
      },
      borderRadius: {
        control: "10px",
        panel: "12px",
      },
      boxShadow: {
        panel: "none",
      }
    },
  },
  plugins: [],
}
