FROM node:20-alpine

WORKDIR /app

COPY . .

WORKDIR /app/server
RUN npm install
RUN npm run build

EXPOSE 3001

CMD ["npm", "run", "start"]
