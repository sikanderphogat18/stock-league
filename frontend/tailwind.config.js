/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        ink: "#0b0f17",
        panel: "#121826",
        edge: "#1f2937",
        gain: "#22c55e",
        loss: "#ef4444",
        gold: "#eab308",
      },
    },
  },
  plugins: [],
};
