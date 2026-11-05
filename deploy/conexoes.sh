#!/bin/sh
# Mostra como cada amigo está ligado ao Umbrel pela Tailscale: DIRETO (melhor ping) ou por RELAY (servidor intermediário
# da Tailscale: mais atraso e banda limitada). Também testa se a rede do Umbrel permite ligações diretas.
# Uso (do seu PC, igual ao deploy): sh deploy/conexoes.sh [usuario@host]
# Só lê informações; não muda nada.
# O endereço do servidor não fica no repositório: passe como argumento ou crie deploy/servidor.conf
# (ignorado pelo git) com a linha: SERVIDOR=usuario@ip-da-vpn
[ -f "$(dirname "$0")/servidor.conf" ] && . "$(dirname "$0")/servidor.conf"
TARGET=${1:-$SERVIDOR}
[ -n "$TARGET" ] || { echo "Informe o servidor: sh $0 usuario@ip-da-vpn  (ou crie deploy/servidor.conf com SERVIDOR=usuario@ip)"; exit 1; }
ssh "$TARGET" 'sh -s' <<'REMOTO'
TS=""
if command -v tailscale >/dev/null 2>&1; then TS="tailscale"
else C=$(docker ps --format "{{.Names}} {{.Image}}" 2>/dev/null | grep -i tailscale | head -1 | cut -d" " -f1); [ -n "$C" ] && TS="docker exec $C tailscale"; fi
if [ -z "$TS" ]; then echo "Não encontrei a Tailscale no Umbrel (nem o programa, nem o container do app)."; exit 1; fi
echo ""
echo "== Amigos conectados agora =="
# linhas de "tailscale status": IP  nome  usuário  sistema  estado (active; direct IP:porta | active; relay "sao")
$TS status 2>/dev/null | awk '
  /^100\./ {
    ip=$1; nome=$2; linha=$0
    if (linha ~ /active/) {
      if (linha ~ /direct/) { match(linha, /direct [^ ,]+/); printf "  %-22s %-15s DIRETO  (%s)\n", nome, ip, substr(linha, RSTART+7, RLENGTH-7); d++ }
      else if (linha ~ /relay/) { match(linha, /relay "[^"]+"/); printf "  %-22s %-15s RELAY   (%s)  <- mais lento\n", nome, ip, substr(linha, RSTART, RLENGTH); r++ }
      else { printf "  %-22s %-15s ativo (sem tráfego agora)\n", nome, ip }
    }
  }
  END { if (d + r == 0) print "  (ninguém trocando dados agora: rode de novo com o pessoal na call)"; else printf "\n  %d direto(s), %d por relay\n", d, r }'
echo ""
echo "== Rede do Umbrel (tailscale netcheck) =="
$TS netcheck 2>/dev/null | grep -Ei "UDP:|MappingVariesByDestIP|PortMapping|Nearest DERP|IPv4:" | sed 's/^/  /'
echo ""
echo "Como ler:"
echo "  - DIRETO é o ideal. RELAY passa por um servidor da Tailscale: mais ping e banda limitada (transmissões travam)."
echo "  - Para todo mundo ligar direto: no roteador da casa do Umbrel, encaminhe a porta UDP 41641 para o IP local do"
echo "    Umbrel (ou ative o UPnP). 'PortMapping' vazio e 'MappingVariesByDestIP: true' indicam que isso ainda falta."
echo "  - Quem continuar em RELAY: o problema é a rede dessa pessoa (roteador/operadora com NAT restrito, CGNAT)."
echo "    UPnP ligado no roteador dela costuma resolver."
REMOTO
