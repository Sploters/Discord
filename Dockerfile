FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ffmpeg python3 ca-certificates curl  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod 755 /usr/local/bin/yt-dlp  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts/reset-password.mjs ./scripts/reset-password.mjs
ENV DATA_DIR=/data PORT=3000 HTTPS_PORT=3443
VOLUME /data
# 40000 = mídia do SFU de voz (UDP e TCP); 40001-40010 = transmissão nativa (UDP); defina RTC_ANNOUNCED_IP=<ip da VPN do host>
EXPOSE 3000 3443 40000/udp 40000/tcp 40001-40010/udp
CMD ["node", "server/index.js"]
