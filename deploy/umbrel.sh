#!/bin/sh
# Envia o código para o Umbrel, reconstrói a imagem e recria o container com os mesmos dados.
# Uso: sh deploy/umbrel.sh [usuario@host] [ip-da-vpn]
# Requer chave SSH no servidor e o usuário no grupo docker.
set -e
TARGET=${1:-umbrel@100.105.3.128}
IP=${2:-${TARGET#*@}}
cd "$(dirname "$0")/.."
tar czf - Dockerfile README.md package.json package-lock.json .gitignore deploy public server scripts | ssh "$TARGET" "
  set -e
  mkdir -p ~/localcord ~/localcord-backups
  # limpa o código antigo para não sobrar arquivo removido/renomeado (os dados ficam em ~/localcord-data)
  cd ~/localcord && rm -rf deploy public server scripts && tar xzf -
  docker build -q -t localcord . >/dev/null
  # backup do banco antes de trocar o container
  tar czf ~/localcord-backups/data-\$(date +%Y%m%d-%H%M%S).tgz -C ~/localcord-data \$(cd ~/localcord-data && ls localcord.db*)
  # cookies do YouTube (opcional): coloque ~/localcord-data/cookies.txt no servidor
  COOKIES=; [ -f \$HOME/localcord-data/cookies.txt ] && COOKIES='-e YTDLP_COOKIES=/data/cookies.txt'
  docker rm -f localcord >/dev/null 2>&1 || true
  docker run -d --name localcord --restart=always \
    -p 3000:3000 -p 3443:3443 -p 40000:40000/udp -p 40000:40000/tcp \
    -v \$HOME/localcord-data:/data -e TLS_SAN=IP:$IP -e RTC_ANNOUNCED_IP=$IP \$COOKIES localcord >/dev/null
  sleep 4
  docker logs localcord 2>&1 | head -3
"
