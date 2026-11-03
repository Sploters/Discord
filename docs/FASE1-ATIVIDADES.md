# Fase 1 — Social Activity Feed (Steam primeiro)

Escopo desta etapa: **só Steam**. Nada de Riot/Epic. Não toca na Fase 3.

## 1. Auditoria do que já existe (e será reaproveitado)
| Necessidade | Já existe | Uso |
|---|---|---|
| Amigos | `relationships(user_id, other_id, type)`; amigo = `type=1` nas duas direções (3 = pedido recebido, 4 = pedido enviado, 2 = bloqueado) | quem pode ver a atividade |
| Entrega em tempo real | `dispatch(userIds, type, d)` + `conns` | evento novo `ACTIVITY_UPDATE` |
| Estado inicial | `buildReady(uid)` | `READY.activities` (amigos jogando agora) |
| Online/offline | `pubUser().status` (`conns` + `users.status`) | continua sendo a presença do **LocalCord**; a Steam é outra camada |
| Chamadas/transmissões | `S.voice` (quem está em qual sala, `screen`), `joinVoice`, `voice.openStream` | botões "Entrar na chamada" / "Assistir" dos cartões |
| Preferências | `users.settings` (JSON sincronizado) | preferências de interface do feed |
| Perfil | `card.js`, `profile()` em `app.js` | seção "Jogos" e abertura do perfil |
| Migrações | `CREATE TABLE IF NOT EXISTS` em `server/db.js` | novas tabelas |
| Abrir link externo | desktop: `setWindowOpenHandler` → `shell.openExternal` | o fluxo OpenID abre o navegador do sistema |

Não existe: ligação a plataformas externas, eventos de atividade, privacidade de atividade, polling com cache.

## 2. Arquitetura
```
server/integrations/index.js   registro de adaptadores + contrato comum
server/integrations/steam.js   ÚNICO arquivo que conhece a Steam (OpenID + Web API)
server/activity.js             agendador/cache/backoff/rate limit + geração de eventos (agnóstico de plataforma)
server/index.js                rotas /api/integrations/*, /api/activity/*, evento ACTIVITY_UPDATE
```
**Contrato do adaptador** (`id`, `name`, `capabilities`):
`configured()` · `startLink({ returnTo, realm })` → URL · `finishLink(query, { returnTo })` → `{ external_id, … }` · `poll(externalIds)` → `Map(external_id → snapshot)`.
`snapshot` normalizado: `{ name, avatar, profileUrl, state: 'online'|'offline'|'away'|…, visibility: 'public'|'private', game: { id, title } | null }`.
O resto do LocalCord só enxerga snapshots; trocar/adicionar Riot depois é escrever outro arquivo de adaptador.

### Dados (SQLite)
- `linked_accounts(user_id, platform, external_id, display_name, avatar, profile_url, visibility, linked_at, last_sync, sync_state)` — **sem token** (Steam OpenID não gera segredo por usuário). Único por `(user_id, platform)` e por `(platform, external_id)`.
- `activities(id, user_id, platform, kind, game_id, title, data, created_at)` — eventos `game_start` / `game_stop` (com duração da sessão observada).
- `game_prefs(user_id, platform, game_id, hidden)` — jogos que o usuário esconde.

### Privacidade
- `visibility` por conta vinculada: `friends` (padrão) · `off` (nada é coletado nem mostrado).
- Jogos escondidos nunca viram atividade. Perfil Steam privado → `visibility: private` → só "vinculado", sem jogo.
- A atividade só é enviada a **amigos** (`relationships.type=1`, nas duas direções) e ao próprio usuário. Desvincular apaga a conta vinculada e o histórico dessa plataforma.
- Sem scraping, sem endpoints privados, sem credenciais: só OpenID oficial + Web API oficial com a chave do servidor.

### Cache, limites e indisponibilidade
- Polling em lote: `GetPlayerSummaries` aceita 100 ids/chamada → 1 chamada/minuto atende até 100 usuários vinculados (≈1.440 chamadas/dia vs. limite de ~100.000).
- Intervalo padrão 60 s (env `STEAM_POLL_SECS`, mínimo 30); só consulta contas com `visibility != off` e com dono conectado **ou** com amigo conectado (ninguém vendo = não gasta chamada).
- Cache em memória do último snapshot por conta; eventos só quando algo muda.
- Backoff exponencial (2×, teto 15 min) em 429/5xx/timeout e **parada** em 401/403 (chave inválida); estado exposto em `/api/integrations` (`sync_state`), sem derrubar o servidor.
- Tempo de jogo (`GetRecentlyPlayedGames`, `GetOwnedGames`) e conquistas: por usuário, sob demanda ao abrir o perfil, cache de 30 min, e só se o perfil/“detalhes dos jogos” for público.

## 3. Quando a `STEAM_API_KEY` é necessária
- **Não precisa** (etapas 1–3 abaixo): esquema do banco, vincular/desvincular via OpenID (a verificação é um `check_authentication` contra a própria Steam, sem chave), rotas, UI de configurações, e testes com um servidor Steam simulado.
- **Precisa**: ler nome, avatar, jogo atual, estado e tempo de jogo de qualquer perfil (Web API). Ou seja, a partir da etapa 4 em produção. Sem a variável o servidor avisa no log, mostra "Steam sem chave no servidor" em Configurações e mantém só a vinculação.
- A chave entra **apenas** como variável de ambiente do container (`-e STEAM_API_KEY=…` no `deploy/umbrel.sh`, lida de um arquivo fora do repositório no servidor). Nunca vai ao cliente, ao git nem aos logs.

## 4. Etapas (pequenas, testáveis)
1. **Esquema + contrato + adaptador Steam (OpenID)** — vincular/desvincular/privacidade. *(sem chave)*
2. **Agendador e cache** (`activity.js`) com Steam simulado: eventos, backoff, privacidade, jogos escondidos. *(sem chave)*
3. **Gateway/REST do feed**: `READY.activities`, `ACTIVITY_UPDATE`, `GET /api/activity/feed`. *(sem chave)*
4. **Interface**: Configurações → Contas vinculadas; aba "Atividade" com cartões (jogo, há quanto tempo, perfil, mensagem, entrar na chamada/assistir, convidar). *(sem chave)*
5. **Teste real com a chave** + tempo de jogo/eventos recentes por perfil. ***(precisa da chave — peço neste ponto)***
6. Deploy (somente com sua autorização), documentação final.

## 5. Riscos / limitações conhecidas
- O OpenID abre o navegador do sistema e volta ao servidor: o navegador precisa alcançar o endereço do servidor (VPN/Tailscale) e aceitar o certificado autoassinado no HTTPS.
- A Steam só informa jogo atual se o perfil e "detalhes do jogo" forem públicos; jogos fora da Steam (ou não adicionados a ela) não aparecem.
- Sem webhook: atualização por polling (≈1 min de atraso).

---
# Resultados das etapas 1–4 (sem chave Steam real)

## O que foi implementado
- **Etapa 1** — `linked_accounts` / `activities` / `game_prefs`; adaptador Steam (OpenID); rotas `GET /api/integrations`, `POST …/:platform/link`, `GET …/:platform/callback`, `PATCH`, `DELETE`.
- **Etapa 2** — `server/activity.js` (agnóstico de plataforma): consulta **em lote** (1 chamada para todas as contas vinculadas, até 100 ids), cache do último snapshot, backoff exponencial (teto 15 min), suspensão em 401/403, política de "ninguém vendo, não consulta", dado velho (> 3 ciclos) não é exibido, eventos `game_start`/`game_stop` (com duração da sessão observada), limpeza de histórico (30 dias / 200 por usuário).
- **Etapa 3** — `READY.activities`, evento `ACTIVITY_UPDATE`, `GET /api/activity/feed`, `PUT /api/activity/games/:platform/:gameId` (esconder jogo), `GET /api/activity/hidden`, evento `INTEGRATION_UPDATE` (a página de contas atualiza sozinha).
- **Etapa 4** — Configurações → **Contas vinculadas**; aba **Atividade** no início (cartões); "Jogando …" no painel "Ativo agora"; ações de voz condicionais.

## Privacidade (regra única, no servidor)
`canSee(viewer, owner) = viewer == owner  OU  (visibility == 'friends' E amigos aceitos nas duas direções)`.
É a mesma função para os eventos em tempo real (destinatários calculados **antes** do envio), o `READY` e o feed — não há filtro só na interface.
- `visibility` (atividade/jogo atual): `friends` (padrão) ou `off` (nada é consultado, guardado nem mostrado a ninguém; as consultas à Steam nem incluem a conta).
- `link_visibility` (o fato de ter a conta vinculada): independente de `visibility`.
- Jogo escondido nunca vira evento nem aparece no histórico; desfazer amizade corta a visão na hora (e refazer devolve na hora); desvincular avisa os amigos, apaga conta, histórico, preferências e o cache.
- A chave `STEAM_API_KEY` só existe em `process.env` do servidor e na URL da requisição à Steam; os testes verificam que ela não aparece em nenhuma resposta ao cliente.

## Ações dos cartões (só quando a situação real permite)
- **Entrar**: a pessoa está numa chamada que posso acessar e eu não estou nela.
- **Assistir**: ela está transmitindo e eu não estou assistindo (fora da sala: entra e abre a transmissão em destaque; dentro da sala com a transmissão fechada: abre).
- **Convidar**: eu estou numa sala de servidor, a pessoa é membro desse servidor, está online e fora da sala → envia uma DM com o link da sala (`/#/<servidor>/<canal>`). Base para convites mais ricos depois.
- Perfil, Mensagem e (no meu próprio cartão) "Esconder jogo" sempre disponíveis. Os cartões se redesenham a cada mudança de voz/transmissão para nunca mostrar ação indisponível.

## Testes automatizados (todos passam)
| Script | Verificações | Cobre |
|---|---|---|
| `scripts/steam-test.mjs` | 25 | OpenID: fluxo feliz, `state` de uso único, `return_to` adulterado, provedor falso, SteamID malformado, assinatura recusada, cancelamento, conta duplicada, desvincular, sem chamadas à API sem chave |
| `scripts/activity-test.mjs` | 65 | 5 usuários (amigos, não-amigo, `off`, perfil privado) com Steam simulada: lote único, `off` nunca consultado, **matriz de destinatários** (nenhum evento a quem não é amigo), READY e feed com as mesmas regras, off/friends, vínculo × atividade, jogo escondido, troca/fim de jogo + duração, desfazer/refazer amizade, desvincular (polling parado, feed e READY limpos), Steam 500 (backoff, login/READY/amizades normais, recuperação) e 403 (consultas suspensas) |
| `scripts/activity-ui-test.mjs` | 26 | Edge headless com 3 usuários reais: vincular, página de contas se atualiza, aba Atividade, "Jogando …" no painel lateral, Entrar/Assistir/Convidar aparecendo e sumindo conforme a situação, Assistir abre a transmissão em destaque, privacidade refletida na tela, esconder jogo, desvincular, sem erros de JS |
Regressão: `fase2-test.mjs` (37 verificações da Fase 2) continua passando; `ui-test.mjs` mantém só as falhas já conhecidas do ambiente headless (vídeo da tela, largura 0 px, soundboard), idênticas às anteriores.

## Limitações conhecidas
- **Nada foi testado com a Steam real** (etapa 5, depende da `STEAM_API_KEY`).
- "Há quanto tempo está jogando" conta a partir do momento em que o servidor observou o jogo (reiniciar o servidor reinicia o contador das sessões em andamento; a Steam não informa o início).
- Tempo total de jogo, jogos recentes e conquistas (`GetRecentlyPlayedGames`/`GetOwnedGames`) ainda não foram implementados — ficam para a etapa 5 por exigirem a API real; dependem de o perfil/“detalhes dos jogos” ser público.
- Atraso de até ~1 ciclo de polling (60 s por padrão) e somente para contas com alguém online para ver.
- O convite é uma mensagem com link (funciona para membros do mesmo servidor); não há convite de pessoas de fora do servidor nem aceitar/recusar dentro do app.
- O OpenID abre o navegador do sistema, que precisa alcançar o servidor (VPN/Tailscale; certificado autoassinado gera aviso).
- Sem deploy no Umbrel; sem Riot/Epic; Fase 3 não iniciada.

## Próximo passo (etapa 5)
Precisa de: `STEAM_API_KEY` (gratuita em steamcommunity.com/dev/apikey). Será configurada **só** como variável de ambiente do container no Umbrel, fora do repositório.
