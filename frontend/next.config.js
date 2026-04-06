const isE2E = process.env.NEXT_E2E === "true";

const e2ePublicEnv = isE2E
  ? {
      NEXT_PUBLIC_USE_MOCK_API: "false",
      NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:5000/api",
      NEXT_PUBLIC_MIDDLEWARE_BASE_URL: "http://127.0.0.1:8000"
    }
  : {};

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    ...e2ePublicEnv
  }
};

export default nextConfig;
