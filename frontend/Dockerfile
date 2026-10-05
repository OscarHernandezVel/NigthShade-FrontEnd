# Build context: repository root (frontend imports ../shared)
FROM node:22-alpine AS build
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
WORKDIR /app
COPY shared ./shared
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
RUN cd frontend && npx vite build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
