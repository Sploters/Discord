FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV DATA_DIR=/data PORT=3000 HTTPS_PORT=3443
VOLUME /data
EXPOSE 3000 3443
CMD ["node", "server/index.js"]
