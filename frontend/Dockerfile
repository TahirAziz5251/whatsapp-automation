# ==============================================================================
# BIZFLOW AI — NEXT.JS 14 WEB DASHBOARDS PRODUCTION DOCKERFILE
# ==============================================================================
FROM node:20-alpine AS runner
WORKDIR /app

# Install build prerequisites and pnpm
RUN apk add --no-cache libc6-compat curl
RUN npm install -g pnpm@9

# Install dependencies
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile

# Copy application source code
COPY . .

# Set environment variables for production build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Build Next.js application
RUN pnpm run build

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000 || exit 1

# Start production server
CMD ["pnpm", "start"]
