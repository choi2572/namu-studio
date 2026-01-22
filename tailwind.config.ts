import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/features/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        "status-running": "#2563eb",
        "status-success": "#16a34a",
        "status-failed": "#dc2626",
        "status-canceled": "#6b7280",
        "status-skipped": "#94a3b8",
        "status-waiting": "#d97706"
      }
    }
  },
  plugins: []
};

export default config;
