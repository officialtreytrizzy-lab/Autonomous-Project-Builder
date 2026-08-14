import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  serverExternalPackages: ['file-type', 'mammoth', 'pdfjs-dist'],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
