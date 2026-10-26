/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {},
  experimental: {
    externalDir: true,
  },
}

export default nextConfig
