# Banda e latência (2026-11-04)

Servidor em SP (Umbrel, internet de casa), amigos de outros estados pela Tailscale. O que mais pesa para quem está longe:
1. **Upload do servidor**: o SFU repassa a voz de cada pessoa para todas as outras (e as transmissões para quem assiste).
   Se o upload da casa enche, a latência e as perdas sobem para todo mundo.
2. **Caminho da VPN**: ligação **direta** entre o amigo e o Umbrel ou por **relay** (DERP) da Tailscale, que soma atraso e
   tem banda limitada.
3. **Rede de cada um**: Wi-Fi, perda de pacotes, UDP bloqueado (voz cai para TCP).

## Medido (`node scripts/bandwidth-audit.mjs`, 4 pessoas, microfone falso tocando sem parar = pior caso)
| | Antes | Depois |
|---|---|---|
| Voz no "Auto" | subia até 384 kbps, **estéreo** | **64 kbps mono** (48/32 com perda ou ping alto) |
| Voz enviada por pessoa (real) | ~261 kbps | **~46 kbps** |
| Saída do servidor, 4 pessoas | 3,1 Mbps | **0,55 Mbps** |
| Projeção, 10 pessoas falando juntas | 23,5 Mbps | **4,1 Mbps** |
| Buffer de recepção (atraso de jitter) | 33-41 ms | 31-39 ms |
Com DTX, quem está calado manda quase nada: o uso real é bem menor que o pior caso.

## O que mudou
- **Voz** (`public/voice.js`): "Auto" = 64 kbps mono (Opus mono e trilha mono; o microfone já era mono, o estéreo só
  duplicava o mesmo som). 128/256/384 continuam como escolha manual (música). Correção de erros (FEC) e DTX mantidos.
- **Espectador com internet fraca** (`server/sfu.js`): o piso de banda de 6 Mbps (que acelera a subida de qualidade das
  transmissões) cai para 800 kbps para quem mostrar perda (nota da conexão < 7). Antes o servidor seguia mandando vídeo
  acima do que a internet da pessoa aguentava, e a voz dela picotava. Não testado com perda real (sem simulador de rede
  aqui); numa rede boa as notas ficam em 10 e nada muda.
- **Diagnóstico no app**: clicar no ícone de sinal do painel de voz mostra o protocolo (UDP é o ideal), a perda, a
  oscilação e dicas: TCP (UDP bloqueado), perda > 2%, ping instável, ping alto (com o comando para conferir a Tailscale).
- **`deploy/conexoes.sh`** (roda do seu PC, como o deploy): lista quem está ligado DIRETO e quem por RELAY, e o
  `tailscale netcheck` do Umbrel.

## Para baixar o ping de quem está longe
1. Rode `sh deploy/conexoes.sh` com o pessoal na call. Quem aparecer como **RELAY** está pagando atraso extra.
2. No roteador da casa do Umbrel: encaminhe a porta **UDP 41641** para o IP local do Umbrel (ou ligue o UPnP). Isso
   permite ligação direta com quase todo mundo.
3. Quem continuar em RELAY: UPnP no roteador dessa pessoa; operadoras com CGNAT às vezes impedem (aí só relay).
4. Cabo em vez de Wi-Fi (no servidor e em quem joga) reduz a oscilação mais do que qualquer ajuste no app.
5. Transmissões: a camada leve (e o modo 120 FPS com a versão de 540p) protege quem tem internet fraca; quem transmite
   em 1080p a 16-24 Mbps precisa de upload compatível.
