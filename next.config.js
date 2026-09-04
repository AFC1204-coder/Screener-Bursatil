/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // `pg` es solo servidor (MIGRATE-2). Evita que el cliente intente bundlear fs/net.
  serverExternalPackages: ["pg"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        pg: false,
        "pg-native": false,
        "pg-cloudflare": false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
