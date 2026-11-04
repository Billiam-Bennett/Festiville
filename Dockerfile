# FestiVille game server: the game page, sign-in/vendor API and the multiplayer server, on one port.
#   docker build -t festiville .
#   docker run -p 2567:2567 -v festiville-data:/app/data festiville
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=2567 FV_DATA_DIR=/app/data
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY client ./client
COPY scripts ./scripts
# Accounts, vendor listings and reports live here; keep it on a volume so they survive updates.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:2567/api/health || exit 1
USER node
CMD ["node", "server/index.js"]
