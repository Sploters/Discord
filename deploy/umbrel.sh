#!/bin/sh
# Envia o código para o Umbrel, reconstrói a imagem e recria o container com os mesmos dados.
# Uso: sh deploy/umbrel.sh [usuario@host] [ip-da-vpn]
# Requer chave SSH no servidor e o usuário no grupo docker.
set -e
# O endereço do servidor não fica no repositório: passe como argumento ou crie deploy/servidor.conf
# (ignorado pelo git) com a linha: SERVIDOR=usuario@ip-da-vpn
[ -f "$(dirname "$0")/servidor.conf" ] && . "$(dirname "$0")/servidor.conf"
TARGET=${1:-$SERVIDOR}
[ -n "$TARGET" ] || { echo "Informe o servidor: sh $0 usuario@ip-da-vpn  (ou crie deploy/servidor.conf com SERVIDOR=usuario@ip)"; exit 1; }
IP=${2:-${TARGET#*@}}
cd "$(dirname "$0")/.."
tar czf - Dockerfile README.md package.json package-lock.json .gitignore deploy public server scripts | ssh "$TARGET" "
  set -e
  # troca de nome (LocalCord -> Resenha), só na primeira vez: para o container antigo e renomeia as pastas.
  # O banco localcord.db vira resenha.db sozinho quando o servidor novo abre.
  if [ -d ~/localcord-data ] && [ ! -e ~/resenha-data ]; then
    docker rm -f localcord >/dev/null 2>&1 || true
    mv ~/localcord-data ~/resenha-data
    echo 'pasta de dados renomeada: ~/localcord-data -> ~/resenha-data'
  fi
  if [ -d ~/localcord-backups ] && [ ! -e ~/resenha-backups ]; then mv ~/localcord-backups ~/resenha-backups; fi
  docker rm -f localcord >/dev/null 2>&1 || true
  rm -rf ~/localcord
  mkdir -p ~/resenha ~/resenha-backups ~/resenha-data
  # limpa o código antigo para não sobrar arquivo removido/renomeado (os dados ficam em ~/resenha-data)
  cd ~/resenha && rm -rf deploy public server scripts && tar xzf -
  docker build -q -t resenha . >/dev/null
  # backup do banco antes de trocar o container
  DB=\$(cd ~/resenha-data && ls resenha.db* localcord.db* 2>/dev/null || true)
  [ -n \"\$DB\" ] && tar czf ~/resenha-backups/data-\$(date +%Y%m%d-%H%M%S).tgz -C ~/resenha-data \$DB
  # cookies do YouTube (opcional): coloque ~/resenha-data/cookies.txt no servidor
  COOKIES=; [ -f \$HOME/resenha-data/cookies.txt ] && COOKIES='-e YTDLP_COOKIES=/data/cookies.txt'
  docker rm -f resenha >/dev/null 2>&1 || true
  docker run -d --name resenha --restart=always \\
    -p 3000:3000 -p 3443:3443 -p 40000:40000/udp -p 40000:40000/tcp -p 40001-40010:40001-40010/udp \\
    -v \$HOME/resenha-data:/data -e TLS_SAN=IP:$IP -e RTC_ANNOUNCED_IP=$IP \$COOKIES resenha >/dev/null
  sleep 4
  docker logs resenha 2>&1 | head -3
"
