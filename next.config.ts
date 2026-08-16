import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: '.next_build',
  reactStrictMode: true,
  output: 'standalone',
  serverExternalPackages: ['file-type', 'mammoth', 'pdfjs-dist'],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
