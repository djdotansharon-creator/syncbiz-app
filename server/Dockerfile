# Production Dockerfile for Railway WS service
# Build context: project root (to access lib/)
# Build: docker build -f server/Dockerfile .

FROM node:20-alpine

WORKDIR /app

# 1. Copy package files for dependency layer caching
COPY server/package.json server/package-lock.json* ./server/

# 2. Install deps (include devDependencies for tsc build)
WORKDIR /app/server
RUN npm ci

# 3. Copy lib (server imports from ../lib/remote-control/types.ts)
WORKDIR /app
COPY lib/ ./lib/

# 4. Copy server source
WORKDIR /app/server
COPY server/ ./

# 5. Build
RUN npm run build

# 6. Start
CMD ["npm", "run", "start"]
