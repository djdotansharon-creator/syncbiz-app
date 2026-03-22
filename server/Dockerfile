# Build from repo root — needed because tsconfig rootDir is ".."
FROM node:20-alpine AS builder

WORKDIR /app

# Copy entire repo (needed for ../lib/remote-control/types.ts)
COPY . .

# Install server dependencies
WORKDIR /app/server
RUN npm install

# Build TypeScript (outDir = server/dist)
RUN npm run build

# ---- Runtime image ----
FROM node:20-alpine AS runner

WORKDIR /app/server

# Copy built output
COPY --from=builder /app/server/dist ./dist

# Copy production dependencies
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./package.json

EXPOSE 3000

CMD ["npm", "run", "start"]
```

---

וצור `server/.dockerignore`:
```
node_modules
dist
.env