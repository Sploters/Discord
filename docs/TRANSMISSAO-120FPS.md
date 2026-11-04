# Transmissão a 120 FPS (app desktop, Windows)

O capturador de tela do Chromium usa o Windows Graphics Capture com o intervalo mínimo padrão (~20,8 ms) e fica em
~48 fps (ver `PASSO0-DIAGNOSTICO-FPS.md`). Acima de 60 FPS o app desktop passa o **vídeo** para um programa próprio
(`native/lc-stream`, empacotado como `lc-stream.exe`), que captura sem esse limite e comprime na placa de vídeo.
Medido no PC de 143 Hz (RTX 3080): 1080p a 120 fps de ponta a ponta, 0 perdas.

## Como funciona
| Parte | O que faz |
|---|---|
| Seletor "Transmitir tela" | 120 fps escolhido + app desktop no Windows + codificador de hardware (`lc-stream --probe`) = modo nativo. Senão, o caminho de sempre. |
| Chromium (`getDisplayMedia`) | Continua capturando a mesma tela/janela, mas só para o **áudio do sistema** (WebRTC, como antes) e a **prévia local**, rebaixada para 10 fps / 360p. |
| Servidor (`sfu.js` `sfuAttachNative`, op `native_start` no gateway) | Cria um `PlainTransport` **SRTP** (AES_CM_128_HMAC_SHA1_80) numa porta de `RTC_NATIVE_PORTS` (40001-40010/udp) e um producer H.264 registrado como a tela da pessoa. Gera a chave de quem envia e devolve as duas chaves só pelo gateway autenticado. |
| App desktop (`desktop/native.js`) | Converte a fonte escolhida (janela = HWND; tela = ponto no centro do monitor, em pixels físicos) e liga o `lc-stream --stdin` com a configuração em JSON pela entrada padrão (as chaves não aparecem na linha de comando). Repassa os eventos (`started`, `stats` 1/s, `error`, `exit`). |
| Versão leve (simulcast) | O app pede **2 camadas**: a cheia (resolução/fps/taxa escolhidas) e uma leve (540p60 a 2,5 Mbps; 360p60 a 1,2 Mbps se a cheia for 720p). O programa abre um codificador e um conversor para cada uma (sessões da mesma placa), com ssrc próprio e o mesmo relógio. O producer tem as duas como simulcast por ssrc: o SFU começa cada espectador na leve e sobe quando a banda dele permite, igual à transmissão normal; também respeita a qualidade escolhida pelo espectador. PLI/FIR/NACK chegam ao fluxo certo pelo ssrc. Se a placa não abrir a sessão extra, segue só com a cheia (`layerError`). |
| `lc-stream` | WGC (`MinUpdateInterval = 0`) → BGRA→NV12 com escala e barras pretas no `ID3D11VideoProcessor` → codificador H.264 de hardware do Media Foundation (NVENC/AMF/QuickSync, o da mesma placa) → RTP → **SRTP**. Reenvia por NACK, quadro-chave por PLI/FIR, abre o SRTCP do servidor. Janela redimensionada: recria a captura e mantém a proporção. Tela parada: repete o último quadro ~10x/s. Janela fechada: erro. |

Quem assiste não muda nada: recebe um producer de tela H.264 comum.

## Ao vivo
- Mudar para 60 fps ou menos: o programa para e o vídeo volta para o Chromium (mesma transmissão, sem parar).
- Voltar para 120 fps, ou mudar resolução/taxa no modo nativo: reinicia o programa (1-2 s).
- O programa falhou ou fechou: aviso e a transmissão continua pelo modo normal.
- O servidor encerrou a sessão (reconexão): tenta de novo até 2 vezes, depois volta ao modo normal.
- Painel "Transmissão ao vivo": mostra os fps enviados pelo programa e o codificador.

## Limitações conhecidas
- Só app desktop no Windows (10 1903+; o fim do limite de 48 fps depende do Windows 11, onde existe `MinUpdateInterval`).
- 2 camadas (não 3 como na transmissão normal): no menu de qualidade de quem assiste, "Média" e "Alta" dão a cheia.
- Placas GeForce antigas limitam sessões simultâneas de codificação; com OBS/gravação ligados, a camada leve pode não abrir.
- A prévia local e o clipe da **própria** transmissão saem da captura leve do Chromium (10 fps, 360p).
- Portas UDP 40001-40010 precisam estar abertas/mapeadas (já estão no `deploy/umbrel.sh`).

## Testes
- `node scripts/native-live-test.mjs`: fluxo completo com o app desktop simulado e o programa em versão Linux (ffmpeg no
  lugar da captura + placa): seletor, áudio pelo WebRTC, ~120 fps no palco de quem assiste, camada leve (360p ~60 fps) e volta à cheia, 120→60→120 ao vivo,
  queda do programa, parar.
- `node scripts/native-test.mjs`: teste manual (código) e SRTP — sem a chave o servidor descarta os pacotes.
- `cargo test` em `native/lc-stream`: empacotamento RTP e SRTP (vetores do RFC 3711).
