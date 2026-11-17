# TaskSphere – builds the React app and runs it with the API on one port (5000)
FROM node:20-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache tzdata
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
ENV PORT=5000
EXPOSE 5000
# Create/upgrade tables, load sample data on first run, then start
CMD ["sh", "-c", "npm run migrate && npm run seed && node src/index.js"]
