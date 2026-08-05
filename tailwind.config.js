/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./{app,components,lib,pages,hooks}/**/*.{html,js,ts,jsx,tsx}"],
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        canvas: "#0A0B0C",
        surface: {
          DEFAULT: "#111315",
          raised: "#181B1E",
          hover: "#202428",
          active: "#292E33",
          black: "#0A0B0C",
        },
        border: {
          subtle: "#2A2E32",
          default: "#42484E",
          strong: "#626B73",
          focus: "#F4F5F5",
        },
        action: {
          primary: "#E7EAEC",
          hover: "#F4F5F5",
          text: "#111315",
          confirm: "#D4D7D9",
        },
        status: {
          checked: "#86A98D",
          waiting: "#C2A56C",
          danger: "#CC7770",
        },
        text: {
          muted: "#AAB0B5",
          dim: "#7D858C",
          body: "#D4D7D9",
          heading: "#F4F5F5",
        }
      },
      borderRadius: {
        control: "0",
        panel: "0",
      },
      boxShadow: {
        panel: "none",
      }
    },
  },
  plugins: [],
}
