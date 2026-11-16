# Multi-stage build, mirroring backend/Dockerfile's pattern. Production-only
# image for the "run the whole stack in Docker" scenario (docker-compose.yml's
# `frontend` service) -- day-to-day development still uses `npm run dev`
# (Vite dev server on :5173), documented in docs/PROJECT-OVERVIEW.md.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
