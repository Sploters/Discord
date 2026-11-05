# Resenha — Fase 0: auditoria e planejamento técnico

Data: 2026-11-02. Somente leitura: nenhum código de produto foi alterado.
Tudo abaixo foi verificado lendo o repositório (`server/`, `public/`, `desktop/`, `deploy/`, `scripts/`). O que é hipótese está marcado como **[hipótese]**.

## 1. Estado atual

### Arquitetura
| Camada | Tecnologia | Observações |
|---|---|---|
| Servidor | Node ≥ 22.5, Express 4, `ws`, `node:sqlite`, mediasoup 3 | `server/index.js` (1090 linhas) concentra REST + gateway WS. Módulos separados só para `db.js`, `sfu.js`, `music.js`, `translate.js`. |
| Banco | SQLite (WAL, FKs ligadas) | Migrações **inline** em `db.js`: `CREATE TABLE IF NOT EXISTS`, `addCol()` (ALTER ignorando erro) e `once(chave, fn)` guardado em `meta`. Sem tabela de versão. |
| Cliente web | ES modules puros, sem bundler/framework/TS | `public/app.js` (1732 linhas), `voice.js`, `state.js`, `util.js` (`h()`, `icon()`). Só o mediasoup-client é empacotado (esbuild → `public/vendor/msc`). |
| Desktop | Electron 45, `sandbox + contextIsolation`, preload mínimo (`lcDesktop`) | Carrega a URL do servidor. Sem módulos nativos. Auto-update via GitHub Releases. electron-builder com lista branca de arquivos. |
| Deploy | Docker no Umbrel via `deploy/umbrel.sh` (tar + ssh + `docker build`) | Portas 3000/3443 e 40000 UDP+TCP (SFU). Acesso por VPN (Tailscale). Backup do banco antes de cada deploy. |
| Testes | Scripts Puppeteer em `scripts/` (e2e API/gateway/voz, UI, desktop, captura real no Electron) | **Não existe** lint, typecheck nem build do frontend. |

### Já implementado e reutilizável
- **Contas/sessões:** `users`, `sessions` (token Bearer; gateway usa `?token=`), `users.settings` (JSON sincronizado), `friend_policy`.
- **Presença:** `users.status` + `custom_status` + `status_emoji`; online/offline derivado de `conns` (conexões WS). `broadcastPresence` → `USER_UPDATE` para `sharedAudience` (guildas em comum, amigos, DMs). Estados *jogando/transmitindo* **não existem**.
- **Amigos:** tabela `relationships` (tipo: amigo/pendente/bloqueado), eventos `RELATIONSHIP`.
- **Servidores/canais/permissões:** bitfield `P` (ADMIN, MANAGE_*, KICK, BAN, MODERATE…), cargos, `memberPerms`/`can`, castigo (`timedOut`), auditoria. **Não há permissões por sala de voz/transmissão.**
- **Voz/vídeo:** SFU mediasoup (1 worker, 1 router por sala), produtores `mic|cam|screen|screenaudio`, simulcast 3 camadas para câmera e tela (L1T3 no VP8), consumo com `pause` e `layers` (camada espacial por espectador), fallback P2P (`RTC=0`).
- **Transmissão de tela:** `getDisplayMedia` (no Electron via `setDisplayMediaRequestHandler` + `desktopCapturer`, áudio por loopback), presets 720/1080/1440/origem × 15/30/60 fps, troca de qualidade/fonte ao vivo, H.264 High por hardware quando `mediaCapabilities` diz que é eficiente, com verificação do codificador real (`checkHwEncoder`: cai para VP8 se vier OpenH264), estatísticas de envio (`screenStats`), rebaixamento automático opcional.
- **Já existe boa parte da Fase 2 no cliente:** várias pessoas podem transmitir ao mesmo tempo (um produtor `screen` por participante); tiles `.tile.screen` na mesma grade; foco (`S.focus`), fechar/abrir transmissão por pessoa (`openStream/closeStream` pausa o consumidor no SFU), volume individual da transmissão, PiP (`livepip.js`), tela cheia, zoom, anotação sobre a transmissão, lista de espectadores (`STREAM_WATCH`/`STREAM_VIEWERS`), clipes.
- **Atividades de sala** em memória (`acts`): lousa, editor de código, soundboard, bot de música.
- **Arquivos:** `/api/upload` → `DATA_DIR/uploads`, servidos em `/files/`.
- **Padrões úteis:** `music.js` recebe dependências por `initMusic({...})` (modelo para novos módulos); `dispatch(userIds, tipo, dados)`; `wrap()` nas rotas; rate limit simples em `rateOk`.

### Problema de FPS (não resolvido; preservar a captura atual)
Medido pelo usuário: ~48 fps capturando a tela inteira pedindo 120. O que o código mostra:
- A captura pede `frameRate {ideal, max}` = fps escolhido; o seletor oferece 15/30/60 (o commit `19d0f1e` mencionava 120).
- A codificação em simulcast de **3 camadas** H.264 por hardware roda três encodes por frame; a camada cheia a 1440p/origem em 60+ fps pode ser limitada por encoder, banda inicial ou `qualityLimitationReason`.
- O número exibido hoje é o de `screenStats()` (fps por camada, `qualityLimitationReason`, `encoderImplementation`), que já existe e é a ferramenta certa.
- **[hipótese]** causas candidatas, a testar uma por vez: (a) o capturador do Chromium (WGC/DXGI) entregar menos que o pedido em tela inteira por causa do monitor/VSync/composição; (b) teto de fps do `getDisplayMedia` no Electron; (c) encoder NVENC limitado pelas 3 camadas simulcast; (d) `degradationPreference`/`contentHint`; (e) banda inicial/`maxBitrate`.
- **Plano de investigação (Fase 2, passo 0):** teste instrumentado que mede separadamente fps de captura (`track.getSettings` + `requestVideoFrameCallback` num `<video>` local), fps de codificação (`outbound-rtp.framesEncoded/s` por camada) e fps de recepção (`framesDecoded/s`), variando: 1 camada vs 3, H.264 vs VP8, tela vs janela, fps pedido. Só depois decidir se há alteração; **não** será criada uma segunda captura sem evidência de que o gargalo é a captura do Chromium.

## 2. O que muda em cada fase

### Fase 1 — Social Activity Feed
**Reaproveitar:** `relationships`, `sharedAudience`, `dispatch`, `users.settings`, `status`.
**Criar:**
- Tabelas: `linked_accounts(user_id, platform, external_id, display_name, avatar, token_enc, visibility JSON, linked_at, last_sync)`, `activities(id, user_id, platform, kind, game_id, title, data JSON, created_at)`, `game_prefs(user_id, platform, game_id, hidden, favorite)`, `activity_privacy` (ou colunas em `users`: feed ligado, quem vê).
- `server/integrations/index.js` (registro) + `steam.js`, depois `riot.js`: interface comum `{ id, startLink(), finishLink(), poll(account), capabilities }`.
- `server/activity.js`: agenda de sincronização com cache, backoff e rate limit por plataforma; gera eventos e despacha `ACTIVITY_CREATE` / `PRESENCE_ACTIVITY`.
- Rotas `/api/integrations/*`, `/api/activity`, `/api/users/:id/games`; UI: aba "Atividade" (home), seção no perfil, configurações de privacidade.
**Modificar:** `pubUser` (campo `activity` filtrado por privacidade), `buildReady`, `settings.js` (nova página), perfil em `card.js`/`app.js`.

**Viabilidade por plataforma (oficial):**
- **Steam — viável.** Login por **OpenID 2.0** (sem segredo; o servidor valida com `check_authentication`). Web API com chave gratuita (`STEAM_API_KEY` no servidor): `GetPlayerSummaries` (nome, avatar, `gameextrainfo`/`gameid` = jogo atual, `personastate`), `GetOwnedGames`, `GetRecentlyPlayedGames`, `GetPlayerAchievements`, `GetSchemaForGame`. Tudo **depende de o perfil/"detalhes do jogo" estar público**; privado devolve vazio. Sem webhook: é polling (limite ~100 mil chamadas/dia por chave; `GetPlayerSummaries` aceita 100 ids por chamada → um poll em lote para todos os usuários vinculados). Sem token por usuário para guardar.
  Ponto de atenção: o navegador do usuário precisa alcançar o servidor pela VPN no retorno do OpenID (já é o caso de quem usa o app); certificado autoassinado gera aviso no navegador do sistema.
- **Riot — parcial e depende de aprovação.** Chave de desenvolvedor pessoal expira em 24 h; produção exige registrar o produto e **aprovação da Riot**. Vincular a conta de forma segura exige **RSO (OAuth)**, que também exige aprovação; sem ele só dá para aceitar "Riot ID digitado" (não verificado). Match-v5/Account-v1/League-v4 existem para LoL/TFT; Valorant (VAL-MATCH) exige chave de produção; partida em andamento (Spectator-v5) existe só para LoL. Não há API pública de presença equivalente à Steam. Sem scraping nem endpoints privados.
- **Epic — fora do escopo útil agora:** não há API pública de amigos/biblioteca/presença para terceiros (EOS exige registro e cobre só jogos do próprio desenvolvedor). Fica apenas a interface do adaptador.
- **Tokens:** quando houver OAuth (Riot), criptografar `token_enc` com AES-256-GCM e chave em `DATA_DIR` (ou variável de ambiente), nunca devolver ao cliente, revogar ao desvincular/excluir conta.

### Fase 2 — Watch (múltiplas transmissões)
**Reaproveitar** quase tudo (ver §1). **Falta:**
- Layouts nomeados (grade, destaque, lado a lado, principal + miniaturas, cinema) sobre a grade atual (`renderVoiceUI`, `S.focus`).
- Painel por transmissão: resolução/fps recebidos, indicador de áudio, qualidade de conexão (`getStats` do consumidor).
- Seleção de qualidade individual (já existe `layers`; falta UI por tile) e **pausa automática de consumidores fora da tela/aba** (hoje só pausa ao "fechar").
- Destaque automático de quem fala e "destacar para todos" (novo evento `ROOM_SPOTLIGHT` no gateway; cliente só segue se o usuário optar por sincronizar).
- Escala do servidor: 1 worker mediasoup. Com N transmissores × V espectadores × 3 camadas, o custo é de reencaminhamento no servidor (Umbrel). Medir antes de criar mais workers (`worker.getResourceUsage`, `sfuStats` já existe).
**Risco:** vários decodificadores 1080p60 simultâneos no cliente; mitigação = camada espacial menor para tiles pequenos e pausa quando oculto.

### Fase 3 — Remote (controle remoto)
**Reaproveitar:** captura/mídia da Fase 2 como transporte de vídeo; gateway WS para sinalização de permissões.
**Criar (nativo):**
- **Auditoria do toolchain:** nesta máquina **não há Rust nem MSVC (`cl`)**. Opções: (A) helper em **Rust** (`windows-rs` + `SendInput`), binário próprio ao lado do Electron, comunicação por named pipe/stdio autenticado; (B) addon N-API em C++ (exige Visual Studio Build Tools + rebuild por versão do Electron). **Recomendação: A** (binário isolado, sem ABI do Electron, menor superfície).
- **Mouse/teclado:** `SendInput`. Limitações do Windows: janelas elevadas (UAC/admin) e alguns jogos com anti-cheat ignoram ou bloqueiam entrada injetada — documentar.
- **Gamepad:** exige driver de controle virtual (ViGEmBus está **descontinuado**; alternativa a avaliar: driver próprio/VHF ou vJoy). É risco técnico alto e exige instalar driver com permissão de administrador.
- **Transporte de comandos separado da mídia:** canal autenticado servidor↔cliente (WS do gateway num primeiro momento; avaliar DataChannel/SCTP do mediasoup se a latência pela VPN não bastar). Mídia continua por SFU. Para jogo remoto de baixa latência, o caminho SFU adiciona um salto: medir (alvo < 80 ms) e considerar P2P direto só para esse modo.
- **Segurança (requisito duro):** sessão de controle criada no servidor, com `owner`, `controller`, permissões `mouse/keyboard/gamepad` separadas, consentimento explícito do dono **no cliente do dono**, comandos validados no servidor (só o controlador autorizado, taxa limitada, tamanho máximo), revogação imediata, encerramento ao sair da chamada/fechar transmissão, indicador permanente não ocultável e atalho global de emergência no processo nativo (não no renderer). O helper só injeta se tiver um token de sessão válido emitido após o consentimento.
- Entrada deve ser aplicada **pelo processo nativo**, nunca por eventos simulados no renderer.

### Fase 4 — Companion (Windows)
- **Decisão a validar:** arquitetura **híbrida** — o Electron atual + o helper nativo da Fase 3 (um só binário nativo, reaproveitado), em vez de um terceiro processo.
- **Detecção de jogos:** lista de processos (`Get-Process`/API nativa) × base de executáveis conhecidos + `gameextrainfo` da Steam para validar; lista de ignorados editável; ligável/desligável. Falsos positivos são o principal risco.
- **Overlay:** por **janela transparente sempre no topo** (funciona em janela/borderless). **Injeção em jogos exclusivos em tela cheia (hook DirectX/Vulkan) não será feita**: risco de banimento por anti-cheat e manutenção alta. Documentar como limitação.
- Atalhos globais já existem (`globalShortcut`: mutar/ensurdecer/clipe); falta tornar configuráveis os demais e a comunicação Companion↔app por pipe local autenticado (sem porta TCP).

### Fase 5 e 6
Integração por eventos (`ACTIVITY` → ação "Entrar/Assistir/Convidar" usando voz/transmissão existentes) e bateria de testes. A Fase 6 deve incluir um **teste de desempenho automatizado** (fps captura/codificação/recepção, bitrate, perdas) a partir da instrumentação do passo 0 da Fase 2.

## 3. Dependências externas
| Item | Quem fornece | Obrigatório para |
|---|---|---|
| `STEAM_API_KEY` (gratuita) | Você, em steamcommunity.com/dev/apikey | Fase 1 Steam |
| Registro de produto + aprovação Riot (RSO, chave de produção) | Você, portal de desenvolvedores Riot | Riot além de "ID digitado" |
| Rust + toolchain MSVC (Build Tools) | Máquina de desenvolvimento | Fases 3–4 |
| Driver de gamepad virtual | A decidir (ver risco) | Gamepad remoto |
| Nenhuma biblioteca npm nova prevista nas Fases 1–2 | — | — |

## 4. Riscos
1. **FPS** desconhecido na origem; pode ser limite do Chromium/Electron, não do código.
2. **Gamepad virtual** (driver descontinuado, instalação com admin).
3. **Controle remoto** é a superfície de maior risco de segurança; exige revisão dedicada antes de qualquer release.
4. **Riot** depende de aprovação externa que pode ser negada ou demorar.
5. **`server/index.js` monolítico** e **sem tipos/lint**: novas áreas devem entrar em módulos próprios para não piorar; sugerir (não impor) um `npm run check` com `node --check`.
6. **Token de sessão na query string** do gateway (`?token=`) aparece em logs de proxy; aceitável hoje na VPN, mas não replicar em novos endpoints sensíveis.
7. **Estado de salas e atividades em memória**: reinício do servidor derruba tudo (aceitável, mas as sessões de controle remoto devem encerrar de forma segura nesse caso).
8. **Carga no Umbrel** com várias transmissões simultâneas.

## 5. Sequência recomendada
0. **Spike de FPS** (instrumentação, sem alterar a captura) — pequeno e destrava decisões da Fase 2 e 3.
1. **Fase 2** (maior parte já existe no cliente → entrega rápida e de baixo risco).
2. **Fase 1** (Steam primeiro; Riot em modo "ID digitado" até haver aprovação).
3. **Fase 4 parcial** (detecção de jogos alimenta Fase 1 e presença) — pode vir junto da Fase 1.
4. **Fase 3** (modo Visualização já existe; depois Assistência mouse/teclado; Gaming/gamepad por último).
5. **Fase 5** e **Fase 6** contínuas.

Se preferir a ordem original (1 → 2 → 3 → 4), nada impede; a única dependência real é: o passo 0 antes da Fase 2, e o helper nativo da Fase 3 antes do overlay da Fase 4.

## 6. Decisões que preciso de você
1. Ordem das fases (a recomendada acima ou a original)?
2. Você consegue criar a `STEAM_API_KEY`? (Sem ela a Fase 1 não sincroniza.)
3. Aceita instalar Rust + Visual Studio Build Tools na máquina de desenvolvimento para as Fases 3–4?
4. Overlay: ok limitar a janela/borderless, sem injeção em jogos em tela cheia exclusiva?
5. Posso começar pelo passo 0 (instrumentação de FPS) assim que aprovado?
