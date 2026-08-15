import path from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceGlob = path
  .join(configDirectory, "src/**/*.{ts,tsx}")
  .replaceAll(path.sep, "/");

const config = {
  // Use an absolute glob because PostCSS passes this object directly to
  // Tailwind. This keeps scanning independent of the process working directory
  // and avoids Tailwind reloading the ESM config inside a Turbopack worker.
  content: [sourceGlob],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#f3f7f8",
          panel: "#ffffff",
          subtle: "#edf3f4",
          line: "#d9e4e7",
        },
        ink: {
          900: "#102a36",
          700: "#334d58",
          500: "#6a7f87",
        },
        harbor: {
          600: "#0b7f86",
          500: "#14949a",
          100: "#e1f3f2",
          50: "#eef9f8",
        },
        mist: {
          50: "#f8fbfb",
          100: "#ecf5f5",
          200: "#d8e8e9",
          300: "#c8dfe1",
        },
        sage: {
          500: "#4f8968",
          100: "#eaf5ee",
        },
        sand: {
          500: "#ad7333",
          100: "#fbf1e4",
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
        soft: "0 18px 50px rgba(16, 42, 54, 0.075)",
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
