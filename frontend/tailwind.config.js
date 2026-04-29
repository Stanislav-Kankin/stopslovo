export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        serif: ["Instrument Serif", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"]
      },
      colors: {
        accent: {
          light: "#2d6a4f",
          dark: "#52b788"
        }
      }
    }
  },
  plugins: []
};
