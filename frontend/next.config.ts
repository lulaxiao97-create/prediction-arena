import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Next 16 blocks cross-origin /_next/* dev requests; without this the HMR socket is refused
  // and a client component tree can stay unhydrated when the app is opened via 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1", "localhost", "0.0.0.0"],
  // Experimental Cache Components / partial prefetching were scaffolded by create-next-app
  // but break client hydration for this fully client-driven dApp under `next dev`
  // (page renders, React never attaches). Keep them off until they are stable.
  turbopack: {
    // The monorepo root also has a bun.lock (Hardhat side); keep the frontend as the root.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
