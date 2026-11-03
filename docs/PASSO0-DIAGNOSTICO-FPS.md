# Passo 0 — Diagnóstico dos ~48 FPS na transmissão de tela

Data: 2026-11-02. Nenhum arquivo de `public/`, `server/` ou `desktop/` foi alterado; nada foi implantado no Umbrel.
Instrumental novo (só em `scripts/`): `fps-diag.mjs` (orquestrador), `fps-diag-server.mjs` (envolve `server/index.js` e lê estatísticas do mediasoup pelo `observer` global), `fps-diag-anim.html` (conteúdo de teste em que **todo quadro muda**) e `fps-diag-edge.mjs` (controle no Edge estável).
Reprodução: `node scripts/fps-diag.mjs [cap] [pipe] [canvas]` (variáveis `WARM`, `MEAS`, `OUT`, `ELECTRON_ARGS`). Gera JSON em `.testshots/`.

## Ambiente
RTX 3080 (driver 32.0.16.1088), monitor 1920×1080 a 143 Hz, Windows 11, Electron 45.1.0, Edge 156.0.4314.58, mediasoup 3.32.0 (binário pré-compilado oficial baixado só para este teste local, em `node_modules`). Tudo roda na mesma máquina (remetente Electron, servidor, receptor Edge e animação), o que acrescenta contenção; ver limitações.

## Como cada estágio foi medido (fontes independentes)
| Estágio | Fonte da medição |
|---|---|
| Fonte (o que a tela realmente muda) | `requestAnimationFrame` da página de animação |
| Captura | `MediaStreamTrackProcessor` sobre o track do `getDisplayMedia` (contagem de quadros e intervalos) |
| Entrega ao codificador | stats `media-source.frames` do remetente |
| Codificação / envio | `outbound-rtp.framesEncoded`, `framesSent`, `totalEncodeTime`, `qualityLimitationReason`, por camada simulcast |
| Servidor | mediasoup: bitrate e pacotes do produtor e do consumidor |
| Recepção / decodificação | `inbound-rtp.framesReceived`, `framesDecoded`, `framesDropped` |
| Renderização | `<video>` do app do espectador: `getVideoPlaybackQuality` e `requestVideoFrameCallback` |

## Resultados medidos

### 1. Captura isolada (`getDisplayMedia`, sem WebRTC e sem codificação), Electron 45, fonte a 144 fps
| fps pedido | tela inteira | janela |
|---|---|---|
| 30 | 29,2 | 29,3 |
| 60 | **48,0** | **48,0** |
| 120 | **48,0** | **48,0** |
| 240 | **48,0** | **48,0** |
O valor pedido acima de 60 não muda nada. Intervalos entre quadros: mediana 17–20 ms, p95 25–35 ms.

### 2. Pipeline completo (captura → codificador → SFU → espectador → render), 15 s medidos após 8 s de aquecimento
Em **todas** as 17 configurações: captura = entrega ao codificador = quadros codificados = quadros recebidos (diferenças < 1 fps), `qualityLimitationReason = none`, `framesDropped ≈ 0`.

| Configuração | fonte | captura | codificados | recebidos | renderizados | ms/quadro (codif.) |
|---|---|---|---|---|---|---|
| tela 1080 pedindo 30, 3 camadas H.264 | 143,8 | 21,4 | 20,1 | 20,1 | 20,1 | 7,3 |
| tela 1080 pedindo 60, 3 camadas H.264 | 144 | 32,2 | 30 | 19,1* | 17,5 | 7,3 |
| **tela 1080 pedindo 120, 3 camadas H.264 (caso do problema)** | 144 | **44,9** | 44,9 | 44,7 | 41,4 | 7,3 |
| idem, repetição | 144 | 45,0 | 45,0 | 45,0 | 41,8 | 7,0 |
| tela 1080 pedindo 120, **1 camada** H.264 | 144 | 44,6 | 44,6 | 44,7 | 42,9 | 6,8 |
| tela 1080 pedindo 120, 3 camadas **VP8** | 144 | 44,7 | 44,7 | 22,0* | 20,8 | 8,4 |
| tela 1080 pedindo 120, 1 camada VP8 | 144 | 44,9 | 44,9 | 43,6 | 37,4 | 5,6 |
| tela 1080 pedindo 60, 1 camada H.264 | 144 | 32,1 | 32,1 | 32,1 | 31,5 | 6,9 |
| tela 1080 pedindo 60, 3 camadas VP8 / 1 camada VP8 | 144 | 35,0 / 32,1 | 34,9 / 32,1 | 21,4* / 8,3* | 20,7 / 4,4* | 8,1 / 5,2 |
| tela **720** pedindo 60 / 120, 3 camadas H.264 | 144 | 32,1 / 44,7 | 32,1 / 44,7 | 32,1 / 44,7 | 31,2 / 43,2 | 3,7 |
| tela "original" pedindo 120, 3 camadas H.264 | 143,9 | 44,8 | 44,8 | 44,0 | 39,7 | 7,7 |
| **janela** pedindo 60, 3 camadas H.264 | 144 | 32,1 | 32,1 | 32,1 | 31,8 | 7,6 |
| **janela** pedindo 120, 3 camadas / 1 camada H.264 | 144 | 48,0 / 48,0 | 48,0 / 48,0 | 46,6 / 48,0 | 43,5 / 47,3 | 7,5 / 6,2 |
| janela pedindo 120, 3 camadas VP8 | 144 | 48,0 | 48,1 | — (sem recepção)* | 0* | 10,8 |

\* Quedas na **recepção/renderização** acompanham a camada escolhida pelo SFU para o espectador (480×270 aparece nessas linhas) ou perda do consumidor; não alteram a conclusão sobre o envio e foram anotadas como observação separada (ver "Achados secundários").

### 3. Teto do codificador (loopback WebRTC local, 1 camada, fonte sintética de canvas, **sem captura de tela**)
| Codec | fps pedido 60 / 120: capturados → codificados | ms por quadro | Codificador |
|---|---|---|---|
| H.264 | 142,2 → 142,1 / 142,8 → 142,8 | 3,8–3,9 | **NVENC** (MediaFoundation) |
| VP8 | 143,3 → 143,2 / 143,0 → 142,9 | 3,0 | libvpx (CPU) |
| VP9 | 143,5 → 142,4 / 143,3 → 142,5 | 5,6–5,8 | libvpx (CPU) |
| AV1 | 143,4 → 143,3 / 143,6 → 143,6 | 3,9 | libaom (CPU) |
Decodificação: ~142 fps nos quatro. (O SFU atual só anuncia VP8 e H.264; VP9/AV1/H.265 estão disponíveis no Chromium, mas não no `MEDIA_CODECS` do servidor.)

### 4. Controles do capturador
| Cenário (captura isolada, tela 1080, fonte 144 fps) | pedido 30 | 60 | 120 | 240 |
|---|---|---|---|---|
| Electron 45, padrão do app | 29,2 | 48,0 | 48,0 | 48,0 |
| Electron 45 + flags `AllowWgcScreenCapturer/WindowCapturer/ZeroHz` | 24,8 | 32,2 | 45,5 | 44,9 |
| **Edge 156 estável** (sem Electron) | 21,4 | 32,2 | 44,7 | 45,0 |
Um caso "livre" (sem restrição de fps) com as flags WGC entregou 0 fps uma vez; tratei esse ponto como instável e não o usei como evidência.

## Gargalo identificado (com evidências)
**O gargalo é o capturador de tela do Chromium (`getDisplayMedia`/desktopCapturer), antes de qualquer codificação.**
1. Em todos os 17 testes de pipeline os contadores de captura, entrega e codificação são iguais; o que sai do capturador é o que chega ao espectador. Nenhuma etapa posterior perde quadros.
2. O codificador **não** limita: `qualityLimitationReason = none` sempre, e com fonte sintética a NVENC codifica 142 fps a 1080p em 3,9 ms/quadro (o app gasta 7 ms com 3 camadas, equivalente a ~140 fps de folga).
3. Número de camadas (1 vs 3), codec (H.264 vs VP8), resolução (720/1080/original) e tela vs janela **não alteram** o teto: ficam entre 44,6 e 48,0 fps pedindo 120.
4. O mesmo teto aparece sem WebRTC, sem codificação e sem servidor (item 1), e também no **Edge estável**, então não é peculiaridade do Electron nem do código do LocalCord.
5. O valor pedido não importa acima de 60: 60, 120 e 240 dão a mesma coisa. Os intervalos entre quadros se agrupam em múltiplos de ~16 ms (mediana 16,1 ms, p95 ~32 ms), padrão de um capturador que amostra em grade de ~60 Hz e perde ticks, contra uma fonte de 144 Hz.

O que **não** foi isolado: *por que* exatamente o capturador entrega 45–48 e não 60. Hipótese (não provada): leitura de quadro por CPU a ~60 Hz e perda de ticks. Para provar seria preciso instrumentar o próprio Chromium ou comparar com um capturador nativo (próximo passo abaixo).

## Achados secundários (não são o gargalo)
- Medido no app do espectador, em alguns testes o SFU entregou a camada de 480×270 (recepção 8–22 fps nas linhas marcadas com *). O envio estava normal; é escolha de camada/consumidor e recomposição do tile. Entra na Fase 2 (seleção de qualidade, pausa fora da tela).
- A renderização fica 1–3 fps abaixo do decodificado em geral (ex.: 44,7 → 41,4), compatível com o compositor do Edge; irrelevante frente ao teto de captura.
- A captura pelo SFU em A1/A2 (21 e 32 fps pedindo 30 e 60) foi menor que a captura isolada (29 e 48), parecida com a do Edge. Há variação do capturador por contexto (com ou sem restrições de tamanho, consumidores extras, carga); não isolei qual fator.

## Limitações do teste
Um único PC (GPU, CPU e monitor compartilhados entre remetente, servidor, receptor e animação); uma execução por configuração (só a linha de referência foi repetida: 44,9 e 45,0); conteúdo sintético; servidor no mesmo host (rede local, sem perda). O JSON bruto do pipeline foi sobrescrito por uma execução vazia; o resumo completo ficou preservado em log local. Não testei jogos reais nem outras GPUs/monitores.

## Recomendação (a aprovar antes de implementar)
**Nada que dependa de restrições do `getDisplayMedia`, camadas, codec ou resolução vai passar de ~48 fps.** Duas ações, em ordem:

1. **Imediato e pequeno (UI/honestidade, sem mexer na captura):** mostrar o fps de captura medido na janela de transmissão (já existe `screenStats`) e rotular 120 fps como "limitado pelo Chromium (~45–48)". Evita prometer o que o capturador não entrega. Não mexe no pipeline.
2. **Correção real:** captura **nativa** (Windows Graphics Capture ou DXGI Desktop Duplication, textura na GPU) → NVENC → RTP para o SFU. Faria parte do helper nativo em Rust já previsto na Fase 3, reaproveitando o toolchain. Antes de comprometer a arquitetura, um **spike isolado, fora do produto**:
   - Spike A: binário Rust que só captura a tela via WGC a 144 Hz e mede fps de captura (sem codificar). Responde se o capturador nativo passa de 60.
   - Spike B (só se o A passar de 60): codificar com NVENC e enviar RTP a um mediasoup local por `PlainTransport`; medir fim a fim.
   - Decisão de encaixe no produto (como autenticar o `PlainTransport` com segurança e como o app escolhe esse caminho) só depois dos dois spikes.

A Fase 2 (Watch) **não depende** disso e pode seguir em paralelo.

## Spike A — primeira execução (2026-11-03, PC secundário)
Pacote `spikes/wgc-capture/pacote` (exe compilado no Linux para `x86_64-pc-windows-gnu`). Máquina: Intel HD Graphics 4000, monitor 1366×768 **60 Hz**, Windows 10 Pro 19045 — **não** é o PC do diagnóstico (RTX 3080, 143 Hz).
- WGC entregou 59,6–59,8 fps estáveis (intervalo mediano 16,7 ms) = teto do monitor.
- `SetMinUpdateInterval` e `SetIsBorderRequired` não existem no Windows 10 ("No such interface supported"); só no Windows 11.
- **Inconclusivo quanto ao conteúdo:** "quadros únicos" ≈ 0 e DXGI com 0,4 fps indicam tela parada — a animação provavelmente não estava visível (o console do teste ficava na frente). Além disso a leitura do número do quadro só estava calibrada para 1920×1080.
- Correções: o teste minimiza o próprio console antes de abrir a animação, codifica o caminho do arquivo na URL, avisa quando a captura só vê quadros repetidos; o spike lê as células escaladas para o tamanho real da tela; saída só em ASCII.
- A pergunta que decide o capturador próprio (passar de ~48 fps num monitor de 143 Hz) **só pode ser respondida no PC de 143 Hz**.

## Spike A — segunda execução (mesmo PC secundário, 60 Hz, animação visível)
| Captura | eventos/s | quadros únicos/s | fonte (animação) |
|---|---|---|---|
| WGC padrão | 84,5 | 51,9 | ~60 |
| WGC "sem limite" (ignorado no Win10) | 86,3 | 55,1 | 59,9 |
| WGC sem borda (ignorado no Win10) | 90,0 | 54,3 | 59,9 |
| DXGI Desktop Duplication | 59,7 | (não verificado nesta versão) | — |

Leitura: o WGC dispara mais eventos que a taxa do monitor, mas ~40 % repetem o quadro anterior; entrega ~87–92 % dos quadros da fonte. O DXGI acompanhou os 60 Hz em contagem de apresentações. A partir desta versão o DXGI também lê o número do quadro (`--verify 1`, classe `IdReader` comum aos dois), para comparação justa. Ainda falta: rodar no PC de 143 Hz e comparar com o capturador do Chromium na mesma máquina.
