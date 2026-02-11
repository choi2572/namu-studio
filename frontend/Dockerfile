# Frontend container: Next.js build + run (same L4T base as backend)
FROM nvcr.io/nvidia/l4t-base:r36.2.0

ENV NODE_ENV=production \
    DEBIAN_FRONTEND=noninteractive \
    NEXT_TELEMETRY_DISABLED=1

# Install Node.js 20 LTS (L4T is Ubuntu 20.04)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies (include dev for build)
COPY package.json package-lock.json* ./
RUN npm ci

# App and build (NEXT_PUBLIC_API_BASE_URL for reverse-proxy: nginx proxies /api to backend)
ARG NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_USE_MOCK_API=false

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
