/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./{app,components,lib,pages,hooks}/**/*.{html,js,ts,jsx,tsx}"],
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        canvas: "#000000",
        surface: {
          DEFAULT: "#141414",
          raised: "#1c1c1c",
          hover: "#242424",
          active: "#2a2a2a",
          black: "#000000",
        },
        border: {
          subtle: "#252525",
          default: "#383838",
          strong: "#555555",
          focus: "#3b82f6",
        },
        action: {
          primary: "#60a5fa",
          hover: "#93c5fd",
          text: "#071a31",
        },
        status: {
          checked: "#34d399",
          waiting: "#d5b479",
          danger: "#fb7185",
        },
        text: {
          muted: "#b7b7bb",
          dim: "#99999f",
          body: "#dedede",
          heading: "#ffffff",
        }
      },
      borderRadius: {
        control: "10px",
        panel: "16px",
      },
      boxShadow: {
        panel: "none",
      }
    },
  },
  plugins: [],
}
