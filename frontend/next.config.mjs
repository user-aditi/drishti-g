/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Complaint and evidence photographs are served by the API, not Next.
    remotePatterns: [{ protocol: 'http', hostname: 'localhost', port: '4000' }],
  },
}

export default nextConfig
