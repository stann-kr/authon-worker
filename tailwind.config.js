/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./{app,components,lib,pages,hooks}/**/*.{html,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#111827", // gray-900
          hover: "#1f2937",   // gray-800
          active: "#374151",  // gray-700
          black: "#000000",
        },
        border: {
          subtle: "#1f2937",  // gray-800
          default: "#374151", // gray-700
          focus: "#ffffff",
        },
        brand: {
          cyan: "#22d3ee",    // cyan-400
          green: "#4ade80",   // green-400
          red: "#f87171",     // red-400
          yellow: "#fbbf24",  // yellow-400
        },
        text: {
          muted: "#9ca3af",   // gray-400
          dim: "#6b7280",     // gray-500
          body: "#d1d5db",    // gray-300
          heading: "#f3f4f6", // gray-100
        }
      }
    },
  },
  plugins: [],
}

