# Fase 2 — Resenha Watch (registro técnico)

Tudo reaproveita o que já existia (grade, destaque + faixa, `setStreamLayer`, `flow`, `STREAM_WATCH`, `ROOM_STATE`).
Nada disto altera o mecanismo de captura.

## 1. Layouts nomeados
- Preferência sincronizada `stageLayout`: `auto` (comportamento clássico), `grid`, `spot` (destaque + faixa), `sidebar` (principal + miniaturas na lateral), `side` (lado a lado), `cinema` (só o destaque).
- Sem destaque escolhido, os layouts de destaque usam a primeira transmissão.
- Botão na barra inferior (aparece com mais de um quadro). Código: `STAGE_LAYOUTS`/`layoutMenu` em `public/app.js`; CSS em `public/extra2.css`.

## 2. Painel de qualidade por transmissão
- Botão (ícone de controles) nos botões da transmissão de outra pessoa. `voice.streamStats(uid)` lê o `inbound-rtp` do consumer: resolução e FPS **recebidos**, bitrate, perda, jitter, travadas, qualidade (boa/média/ruim), áudio da transmissão ligado/desligado, camada em uso.
- Escolha manual de camada por transmissão (Auto/Baixa/Média/Alta): `voice.setLayerPref`. Vale só na sessão.

## 3. Pausa automática fora da tela
- `IntersectionObserver` nos quadros de transmissão; quadro oculto (layout cinema, participantes ocultos, rolado para fora) ou janela escondida por 4 s → `voice.flowVideo(uid, true)` pausa **só o vídeo** no servidor (o áudio continua). Volta na hora ao reaparecer.
- Não pausa com a janela flutuante/PiP/tela cheia ativos, nem quando você está fora da sala (miniatura flutuante).
- Desligável no menu de layout ("Pausar vídeo fora da tela"). Limitação: um quadro pausado não alimenta o buffer de clipes.

## 4. Destacar para todos
- Evento de gateway novo `ROOM_SPOTLIGHT { key: 's:<uid>' | 'c:<uid>' | null }` (qualquer membro da sala), validado no servidor (a transmissão/câmera precisa existir), com limite de 0,5 s por conexão. Estado vai em `ROOM_STATE` (`spot`, `spot_by`); limpa sozinho se o dono do destaque sai ou para de transmitir.
- Quem não quiser acompanhar desliga "Acompanhar destaques da sala" (pref `followSpot`). Botão de estrela nos botões da transmissão; o quadro destacado ganha contorno amarelo.

## 5. Carga do worker único do mediasoup
- `server/sfu.js`: amostra a cada 15 s `worker.getResourceUsage()` (CPU em % de um núcleo entre amostras, RSS) + contagem de salas/peers/transports/producers/consumers; guarda 240 amostras e o pico.
- `GET /api/sfu/load` (autenticado; só donos de servidor). Teste local: worker 1, RSS ~16 MB ocioso, CPU 0 % ocioso.
- **Pendente de medição com carga real** (várias transmissões + vários espectadores): ainda não foi feita; o pico de CPU em `peakCpuPercent` é o sinal para criar mais workers (um por núcleo, uma sala por worker).

## 6. Simulcast de 3 camadas com VP8
Reexecutado com **verificação de conteúdo** (animação visível, id de quadro lido nos pixels):
- Os envios estão corretos: as 3 camadas (480×270, 960×540, 1920×1080) são codificadas com `qualityLimitationReason=none`.
- **Causa dos casos "só chega 480×270" / "perdeu o stream"**: o consumidor do SFU começa na camada **menor** e sobe devagar. A banda estimada no servidor ficava em ~0,3–0,5 Mbps (só a camada pequena é enviada, então a estimativa não cresce), e a subida levou 8–16 s em uma execução e não aconteceu em 23 s em outras (recepção 480×270 a 24 fps = camada baixa + camada temporal reduzida).
- **Correção** (`server/sfu.js`): piso de banda estimada de 6 Mbps nos transportes de recepção (`setMinOutgoingBitrate`; env `SFU_MIN_OUT_KBPS`, `0` desliga). Resultado em B2/B5/D4 (VP8, 3 camadas): camada 2/2 já na primeira amostra, recepção 1920×1080 a ~48 fps, render ~47 fps. Antes: B2 ficou 24 fps em 480×270 numa execução e 8–16 s para subir em outra.
- Limitação: o piso favorece LAN/Tailscale; numa conexão muito lenta o espectador pode receber mais do que a rede aguenta. Nesses casos use a camada Baixa/Média no painel de qualidade ou `SFU_MIN_OUT_KBPS=0`.
- Os ~48 FPS capturados nestes testes são o limite conhecido do capturador do Chromium (ver `PASSO0-DIAGNOSTICO-FPS.md`), não do SFU.

## Validação no Umbrel (2026-11-03, commits a10b213 + correção da unidade de CPU)
Procedimento: backup do banco, da configuração do container e do código em `~/resenha-backups/*-pre-fase2-20261103-002904.*`; imagem anterior marcada `localcord:rollback-pre-fase2` (id 15433da01d12). **Rollback**: `docker rm -f localcord && docker run … localcord:rollback-pre-fase2` com os mesmos parâmetros do `deploy/umbrel.sh` (ou restaurar o `codigo-pre-fase2-*.tgz` e rodar o deploy). Não foi necessário.

Testes (`scripts/fase2-test.mjs`: 2 usuários reais em Edge headless, sala de voz no Umbrel, transmissão simulada por canvas 1280×720@30 em VP8 3 camadas) — 37 verificações, todas ok:
- Layouts: Grade, Destaque + faixa, Principal + miniaturas, Lado a lado, Cinema e volta ao Automático; escolha gravada e sincronizada no servidor.
- Painel de qualidade: 1280×720, 30 FPS recebidos, 2,3 Mbps, perda 0 %; camada Baixa → 320×180; Alta → 1280×720.
- Pausa automática: com 2 s fora da tela ainda recebia (60 quadros em 2 s); com ~5,5 s, 0 quadros em 2 s (pausado); retomada em 242 ms. Exceções: trocar de canal (miniatura flutuante) não pausa. PiP e tela cheia foram **simulados** nas propriedades do `document` (o headless não abre PiP real) — validam a lógica, não o PiP do navegador.
- Destaque: sincronizado entre os dois, com contorno; remover limpa; com "Acompanhar" desligado o foco do bob não muda; transmissor que para a transmissão ou sai da sala limpa o destaque.
- VP8 3 camadas: camada cheia em 377–391 ms nas 3 execuções (antes: 8–16 s ou nunca).
- `/api/sfu/load`: dono 200, membro comum 403, sem login 401.

Carga do worker (`scripts/fase2-load.mjs`: 2 transmissores 1920×1080@30 VP8 3 camadas + 6 espectadores, 8 pessoas na sala, durante 40 s, amostras de 5 s):
| Situação | CPU (1 núcleo) | RSS | peers | transports | producers | consumers |
|---|---|---|---|---|---|---|
| ocioso | 0 % | 10 MB | 0 | 0 | 0 | 0 |
| 8 pessoas só com voz | 8,1 % | 14 MB | 8 | 16 | 8 | 56 |
| + 2 transmissões 1080p, 6 espectadores | média 9,5 %, pico 10 % | 16 MB | 8 | 16 | 10 | 70 |
Limites do teste: todos os clientes rodaram no mesmo PC (Edge headless) e a fonte é um canvas, não um jogo; uma sala só; Umbrel com 12 núcleos e 14,5 GB. **Isso mostra folga para esta carga, mas não prova que um worker basta** para várias salas ao mesmo tempo ou transmissões 1440p/4K a 120 FPS; falta medir mais salas e bitrates maiores. A correção de unidade do CPU (o mediasoup devolve ms) foi feita após a primeira rodada, em que o campo aparecia como 0 %.
