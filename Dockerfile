# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
# Disable husky's root prepare hook inside container installs.
RUN HUSKY=0 npm ci --workspace=frontend --legacy-peer-deps
COPY frontend/ ./frontend/
RUN npm run build --workspace=frontend

# Stage 2: Build backend
FROM node:20-alpine AS backend-build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
RUN HUSKY=0 npm ci --workspace=backend --legacy-peer-deps
COPY backend/ ./backend/
RUN npm run build --workspace=backend

# Stage 3: Production image
FROM node:20-alpine AS production
WORKDIR /app

# Install build tools for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN HUSKY=0 npm ci --workspace=backend --omit=dev --legacy-peer-deps

# Remove build tools after native compilation
RUN apk del python3 make g++

# Copy compiled backend
COPY --from=backend-build /app/backend/dist ./backend/dist

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create data directory and non-root user
RUN addgroup -S graphite && adduser -S graphite -G graphite
RUN mkdir -p /data && chown -R graphite:graphite /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

USER graphite

CMD ["node", "backend/dist/index.js"]
