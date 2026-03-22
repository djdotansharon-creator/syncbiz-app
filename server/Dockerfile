FROM node:20-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json* ./server/

WORKDIR /app/server
RUN npm install

WORKDIR /app
COPY lib ./lib
COPY server ./server

WORKDIR /app/server
RUN npm run build

EXPOSE 3001

CMD ["node", "dist/index.js"]
