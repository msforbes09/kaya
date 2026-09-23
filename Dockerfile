FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY runner/package.json runner/
RUN npm ci --workspace server --workspace web --include-workspace-root
COPY server server
COPY web web
RUN npm run build -w web && npm run build -w server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/server/package.json server/
RUN npm ci --workspace server --omit=dev --include-workspace-root
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/drizzle server/drizzle
COPY --from=build /app/server/drizzle.config.ts server/
COPY --from=build /app/web/dist web/dist
WORKDIR /app/server
EXPOSE 8787
CMD ["npm", "start"]
