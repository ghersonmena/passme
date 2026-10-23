FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --include-workspace-root=false
COPY server server
RUN npm run build -w server && npm prune --omit=dev --workspace server --include-workspace-root=false

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/migrations server/migrations
WORKDIR /app/server
# Sin privilegios de root dentro del contenedor
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
