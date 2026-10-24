import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  // libsql ships native bindings; keep it out of the server bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
  // Keep Next's dev badge off the sidebar's refresh/alerts controls.
  devIndicators: { position: "bottom-right" },
};

export default withEve(nextConfig);
