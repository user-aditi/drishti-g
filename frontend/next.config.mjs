/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The production image serves Next's standalone server, which carries only
  // the files the build traced. Set by the Dockerfile, so `next start` in CI and
  // `next dev` locally are unaffected.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  images: {
    // Complaint and evidence photographs are served by the API, not Next.
    remotePatterns: [{ protocol: 'http', hostname: 'localhost', port: '4000' }],
  },
}

export default nextConfig
