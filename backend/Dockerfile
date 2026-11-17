# Multi-stage build. "development" target runs with hot-reload for local
# work; "production" target is the minimal, hardened image used by the
# signed server-update bundle flow (Part 9.7).

FROM node:22-alpine AS base
WORKDIR /app
# postgresql-client provides pg_dump, used by BackupService (Part 9.8 nightly backup).
RUN apk add --no-cache postgresql16-client
COPY package.json package-lock.json* ./
RUN npm install

FROM base AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

FROM base AS build
ENV NODE_ENV=production
COPY . .
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache postgresql16-client
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN addgroup -S rmp && adduser -S rmp -G rmp
USER rmp
EXPOSE 3000
CMD ["node", "dist/main.js"]
