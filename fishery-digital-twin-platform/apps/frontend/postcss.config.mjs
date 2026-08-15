import tailwindConfig from "./tailwind.config.mjs";

export default {
  // Pass the resolved object instead of a config path. Tailwind 3 otherwise
  // reloads the ESM file inside Next.js workers, which can yield an undefined
  // config under Turbopack on newer Node.js versions.
  plugins: {
    tailwindcss: { config: tailwindConfig },
    autoprefixer: {},
  },
};
