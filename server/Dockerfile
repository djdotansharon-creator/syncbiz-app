# syncbiz-ws — build context must be repository root (not /server alone).
# Railway: Root Directory = / (empty), Dockerfile path = server/Dockerfile
# (or RAILWAY_DOCKERFILE_PATH=server/Dockerfile). Do not COPY root package.json — it runs prisma postinstall.

FROM node:20-alpine

WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/ .
RUN npm run build

EXPOSE 3001

CMD ["npm", "run", "start"]
