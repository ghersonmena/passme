FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace client --include-workspace-root=false
COPY client client
RUN npm run build -w client

FROM nginx:1.29-alpine
RUN apk add --no-cache openssl
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/10-self-signed-cert.sh /docker-entrypoint.d/10-self-signed-cert.sh
RUN chmod +x /docker-entrypoint.d/10-self-signed-cert.sh
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 443
