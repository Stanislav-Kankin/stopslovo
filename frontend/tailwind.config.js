export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        logo: ["Playfair Display", "serif"],
        mono: ["JetBrains Mono", "monospace"],
        sans: ["Golos Text", "system-ui", "sans-serif"]
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
