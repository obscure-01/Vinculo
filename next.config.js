/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/',
        destination: '/index.html',
      },
      {
        source: '/privacy',
        destination: '/privacy.html',
      },
      {
        source: '/terms',
        destination: '/terms.html',
      },
      {
        source: '/delete-data',
        destination: '/delete-data.html',
      },
      {
        source: '/:path*',
        destination: '/index.html',
      },
    ];
  },
};

module.exports = nextConfig;
