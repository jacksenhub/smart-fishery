import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#f6f8fb",
          panel: "#ffffff",
          subtle: "#eef3f7",
          line: "#dfe6ee",
        },
        ink: {
          900: "#172033",
          700: "#344256",
          500: "#667085",
        },
        harbor: {
          600: "#0f7f8a",
          500: "#1897a3",
          100: "#e8f6f7",
          50: "#eef9fb",
        },
        mist: {
          50: "#f9fcfd",
          100: "#edf7f9",
          200: "#dbeaec",
          300: "#cfe3e6",
        },
        sage: {
          500: "#5f8f72",
          100: "#edf6ef",
        },
        sand: {
          500: "#a56b2f",
          100: "#fbf3e8",
        },
        ocean: {
          950: "#03111f",
          900: "#061b31",
          800: "#0a2947",
          700: "#0e3a62",
        },
        cyanTech: "#41f3ff",
        aqua: "#57ffd6",
      },
      boxShadow: {
        soft: "0 18px 50px rgba(23, 32, 51, 0.08)",
        glow: "0 0 36px rgba(65, 243, 255, 0.18)",
        panel: "0 24px 80px rgba(0, 0, 0, 0.34)",
      },
      backgroundImage: {
        deepsea:
          "radial-gradient(circle at 20% 10%, rgba(65,243,255,.16), transparent 34%), radial-gradient(circle at 82% 28%, rgba(87,255,214,.1), transparent 28%), linear-gradient(135deg, #03111f 0%, #071a30 54%, #020711 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
