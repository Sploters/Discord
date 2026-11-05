# Resenha

Chat + voz + vídeo + transmissão de tela auto-hospedado, com layout inspirado no Discord. O servidor roda em Linux/Umbrel/Docker; os amigos usam o **aplicativo desktop** (Windows) ou o navegador, conectados pela VPN (Tailscale / Hamachi / Radmin). Não usa código nem assets do Discord.

## Recursos
- **Servidores:** categorias, canais de texto e de voz (com chat ao lado), convites gerenciáveis, cargos com permissões, apelido por servidor, ícone/banner/descrição/cor, **emojis personalizados** (`:nome:`), **soundboard do servidor**, mensagem de boas-vindas, reordenar canais, transferir propriedade, notificações por servidor/canal.
- **Mensagens:** markdown, respostas, edição, fixadas, reações (inclusive emoji do servidor), menções, anexos, pré-visualização de imagens de links, busca, "digitando…", não lidas.
- **Mensagens de voz:** botão de microfone no compositor grava (até 5 min) com forma de onda ao vivo, pré-escuta e envio; o player mostra as barras, permite pular no trecho e acelerar (1x/1,5x/2x).
- **Tradução:** clique direito → Traduzir (mostra sob a mensagem, só para você), botão no compositor para traduzir o rascunho e prefixo `$en`, `$es`, `$ja`… para enviar já traduzido. Idioma e "manter original" em Aparência.
- **Espectadores:** cada transmissão mostra quantos e quem está assistindo (clique no selo para a lista).
- **Clique direito → Entrar na chamada** em quem está em voz.
- **Controle remoto (mouse e teclado):** quem assiste uma transmissão pede o controle; quem transmite (app para Windows, tela inteira) escolhe liberar mouse e/ou teclado. Aviso vermelho sempre por cima enquanto durar, botão Parar e atalho de emergência **Ctrl+Alt+Shift+Q** (só o teclado físico do dono aciona). Avisa sobre jogos com anti-cheat (e detecta os mais comuns rodando no PC). Detalhes e limitações em `docs/FASE3-REMOTE.md`.
- **Procurar jogadores (LFG):** aba abaixo de "Amigos". Anúncios com jogo (Valorant, LoL, CS2, PEAK, R.E.P.O., Minecraft ou outro), modo, vagas, faixa de elo, funções, microfone, agora ou mais tarde, sala de voz e recado. Só vê quem divide servidor com o autor ou é amigo dele (bloqueios respeitados). "Quero entrar" → o autor aceita e a pessoa recebe o convite para a chamada; o anúncio fecha sozinho quando as vagas acabam. "Copiar anúncio" gera o texto para colar em grupos de LFG; atalhos abrem o DUO.OP.GG e o Spikr no jogo certo (nada é coletado desses sites). Perfil de jogador por jogo (Riot ID/nick, elo e funções, com link para OP.GG/Tracker/Faceit) e aviso de anúncios novos por jogo.
- **Enquetes:** botão "+" do chat → Criar enquete. Pergunta, 2 a 10 opções, uma ou várias respostas e prazo (sem prazo, 1 h … 1 semana). Votos ao vivo com porcentagem e quem votou em cada opção; trocar ou tirar o voto; quem criou (ou um moderador) encerra antes; no fim mostra o vencedor. Funciona em canais e DMs.
- **Galeria de clipes:** entrada "Clipes" no topo da lista de canais de cada servidor, com todos os clipes salvos nas salas de voz (Todos / Meus / Favoritos, busca por nome ou pessoa). Prévia que só carrega quando aparece na tela, player com anterior/próximo (setas), renomear, favoritar, baixar, ir para a mensagem e apagar (apaga também a mensagem do chat e o arquivo). Atualiza em tempo real.
- **Convite para a chamada:** numa sala de voz, chame um amigo ou membro do servidor (clique direito → Convidar para a chamada, ou o botão Convidar na aba Atividade). A pessoa recebe um aviso com toque e um cartão na DM com Entrar/Recusar; se ainda não for membro, aceitar já a coloca no servidor e na sala. Quem convidou vê a resposta. O convite vale 5 min.
- **Animações:** transições ao trocar de canal, abrir janelas/menus e receber mensagens (desligam em Acessibilidade → Reduzir animações ou em Aparência).
- **Perfil:** avatar e banner (imagem/GIF), cor, pronomes, status com emoji, bio, prévia ao vivo.
- **Social:** DMs, amigos, bloqueio, privacidade de pedidos, **chamadas de voz/vídeo em DM** com toque.
- **Voz:** WebRTC via **SFU no servidor** (mediasoup: cada um envia uma vez, o servidor repassa; câmera e tela com simulcast), com malha P2P como reserva; redução de ruído por IA (RNNoise e GTCRN, trocáveis ao vivo), porta de ruído, eco, ganho, taxa de bits, push-to-talk, volume por usuário, teste de microfone, latência.
- **Painéis rápidos (barra do usuário):** ▾ do microfone troca **dispositivo de entrada**, modo de ruído, **eco**, porta de ruído, ganho e volume; ▾ do fone troca **dispositivo de saída** e volumes; clicar no seu nome muda **status** (online/ausente/não perturbe/invisível) e status personalizado.
- **Sons:** efeito sonoro para silenciar, ensurdecer, entrar/sair da chamada (você e os outros), câmera, começar/parar transmissão, mensagens, menções, chamada recebida e amizade; cada um liga/desliga, tem volume, teste e opção de **trocar pelo seu próprio áudio**.
- **Soundboard:** sons pessoais (ficam na conta) e dos servidores, tocados para toda a sala de voz; favoritos, volume, silenciar, escolher quais servidores usar e **atalho de teclado por som**.
- **Transmissão de tela:** escolha de tela/janela com miniaturas ao vivo, 720p/1080p/1440p/original, 15/30/60 fps, otimização movimento/nitidez, áudio do sistema, e **mudança de qualidade/fonte durante a transmissão**.
- **Configurações:** Conta (usuário, senha, excluir conta), Perfil, Privacidade e segurança (sessões), Aparência (4 temas, cor, fonte, espaçamento, arredondamento, 12/24h), Acessibilidade, Voz e vídeo, Transmissão, Sons, Soundboard, Notificações, Atalhos configuráveis, Avançado (exportar/importar, modo desenvolvedor). **Tudo sincroniza na conta** (menos dispositivos de áudio).
- **App desktop:** compatibilidade de vídeo para placas antigas (texto borrado, tela cheia com defeito; ver `docs/DESKTOP-VISUAL.md`), janela própria, bandeja, iniciar com o Windows, atalhos globais configuráveis, badge de não lidas, aceleração de hardware, limpar cache.

## Servidor
Requer Node.js >= 22.5 (usa `node:sqlite`) e `openssl`. No Docker/Umbrel já vem no `Dockerfile`.

    npm install --omit=dev
    npm start            # HTTP :3000 e HTTPS :3443

Tradução: `LIBRETRANSLATE_URL` (+ `LIBRETRANSLATE_KEY`) usa uma instância LibreTranslate sua; sem ela, o servidor usa o endpoint público não oficial do Google Tradutor (o texto traduzido sai do servidor). `TRANSLATE=0` desliga.

Variáveis: `PORT`, `HTTPS_PORT`, `HOST`, `DATA_DIR`, `MAX_UPLOAD_MB`, `OPEN_REGISTRATION=0`, `HTTPS=0`, `TLS_KEY`/`TLS_CERT`, `TLS_SAN=IP:<ip-vpn>`, `TURN_URL`/`TURN_USER`/`TURN_PASS`.

Voz (SFU): `RTC_PORT` (padrão 40000, UDP+TCP — libere no firewall), `RTC_IPS` (IPs onde escutar; padrão: todos os IPv4 das interfaces, então suba a VPN **antes** do servidor), `RTC_ANNOUNCED_IP` (em Docker: o IP da VPN do host), `RTC=0` (desliga o SFU e volta à malha P2P). `RTC_NATIVE_PORTS` (padrão `40001-40010`, UDP): transmissão a 120 FPS pelo app desktop no Windows (escolha 120 fps em "Transmitir tela"; ver `docs/TRANSMISSAO-120FPS.md`).

Docker: `docker build -t localcord . && docker run -d --restart=always -p 3000:3000 -p 3443:3443 -p 40000:40000/udp -p 40000:40000/tcp -v ~/localcord-data:/data -e TLS_SAN=IP:<ip-vpn> -e RTC_ANNOUNCED_IP=<ip-vpn> localcord`
Atualizar: reconstrua a imagem e recrie o container com o mesmo volume (o banco migra sozinho).

## Bot de música
Botão 🎵 na barra da chamada: cole um link (YouTube, SoundCloud, Spotify, Bandcamp, Twitch, Vimeo…) ou digite o nome da música. O bot entra na sala como um participante (cada um ajusta o volume dele), mantém uma fila/playlist e qualquer pessoa da sala pode pausar, pular, remover músicas ou tirá-lo da chamada. Sai sozinho após 5 min parado (`MUSIC_IDLE_MIN`) ou quando todos saem. O áudio vem do yt-dlp (sem anúncios) + ffmpeg, ambos já incluídos na imagem Docker; o Spotify só fornece os nomes das faixas, que são procurados no YouTube. Requer o SFU de voz ativo.
Variáveis: `MUSIC_IDLE_MIN`, `MUSIC_ALLOW_ANY=1` (libera qualquer site), `YTDLP_COOKIES=/data/cookies.txt` (se o YouTube pedir login), `YTDLP_PATH`, `FFMPEG_PATH`. Se o YouTube parar de funcionar, refaça o deploy para baixar o yt-dlp atualizado.

### Novidades
Depois de uma atualização, quem já usava o app vê uma vez a janela "Novidades" (o que mudou, com botões "Experimentar"); fica gravado na conta, então não repete em outro aparelho. Conta nova não recebe a lista. Histórico em Configurações → Novidades e no menu do perfil. Para anunciar uma atualização: acrescente uma entrada no topo de `NEWS` em `public/changelog.js` com um id novo (a data).

### Banda e latência
Voz no automático em 64 kbps mono (até 80% menos banda que antes), diagnóstico de conexão no ícone de sinal do painel de voz, e `sh deploy/conexoes.sh` para ver quem liga direto ou por relay na Tailscale. Detalhes e como baixar o ping de quem está longe: `docs/BANDA-E-LATENCIA.md`.

### Desempenho
A interface é entregue comprimida e com cache longo (versão do servidor no endereço dos arquivos; ver `docs/AUDITORIA-DESEMPENHO.md`). `STATIC_OFF=1` desliga isso em caso de problema. Medição: `node scripts/perf-audit.mjs <rótulo>`.

### GIFs
Botão **GIF** no campo de mensagem: busca, "Em alta", Favoritos (por pessoa) e "Do grupo" (GIFs já mandados nos chats que a pessoa vê). A busca usa a **KLIPY** (gratuita; a API da Tenor foi desligada pelo Google em 2026) ou a **GIPHY**. Crie uma chave de API de desenvolvedor no site do serviço e coloque-a num arquivo na pasta de dados do servidor: `~/localcord-data/klipy.key` (ou `giphy.key`), depois reinicie o container (`sh deploy/umbrel.sh`). Também vale a variável `KLIPY_API_KEY` / `GIPHY_API_KEY`. Sem chave, o botão mostra só Favoritos e "Do grupo". O servidor só busca a lista (com cache de 10 min e um id anônimo por pessoa); os GIFs carregam direto do serviço. No modo leve, os GIFs do chat ficam parados e animam ao passar o mouse.

### Efeitos de voz
Na call, o botão de máscara (painel de voz e controles da sala) abre 9 efeitos: Robô, Voz grossa, Esquilo, Monstro, Alien, Rádio, Megafone, Eco e Estádio. Atalho: `Ctrl+Shift+E` liga/desliga o último efeito. A voz vai **normal** pela rede junto com o nome do efeito, e o app de **quem ouve** aplica o efeito (`public/voicefx.js` + worklet `public/fx-pitch.js`). Por isso cada pessoa pode ouvir sem efeito: todo mundo (Configurações → Voz e vídeo, ou no próprio seletor) ou só alguém (clique direito → "Ouvir sem efeito de voz"). Quem está com efeito aparece com o emoji dele ao lado do nome. Os volumes são calibrados para ficar perto da voz normal, com limitador no fim. "Ouvir minha voz" toca o próprio microfone com o efeito (use fone).

### Cortar clipe
No menu de clipes da transmissão, **Salvar e cortar…** abre os últimos 60 s numa linha do tempo para escolher o trecho; na galeria, **Cortar (cria uma cópia)…** faz o mesmo com um clipe já salvo. O corte não recomprime o vídeo (instantâneo, sem perda): o início encaixa no quadro-chave anterior (até ~1 s antes) e o fim é exato.

## Aplicativo desktop (Windows)
O controle remoto usa o programa nativo `native/lc-input` (Rust); o `.exe` já compilado está em `desktop/native/` e entra no instalador. Instaladores em `desktop/dist/`: `Resenha-Setup-<versão>.exe` e `Resenha-Portable-<versão>.exe`. No primeiro uso o app pede o endereço do servidor (IP da VPN). Regerar: `cd desktop && npm install && npm run dist`.

## Desenvolvimento
O cliente do SFU fica em `public/vendor/msc/` (gerado de `mediasoup-client`): `npm install && npm run build:vendor`.

## Testes
    npm run check                                     # sintaxe de todo o JS (rápido, sem servidor)
    BASE=http://localhost:3000 node scripts/e2e.mjs   # API + gateway + voz + soundboard + conta
    BASE=http://localhost:3000 node scripts/features-test.mjs   # mensagem de voz, espectadores e tradução
    node scripts/ui-test.mjs                          # navegador real: 2 usuários, voz pelo SFU, RNNoise, sons, painéis, configurações
    RTC=0 node scripts/ui-test.mjs                    # o mesmo, com voz em malha P2P
    node scripts/desktop-test.mjs                     # app Electron
    node scripts/desktop-share-test.mjs               # Electron transmitindo a tela real para outro usuário
Os testes de navegador usam o Edge do Windows por padrão; em outro sistema aponte `BROWSER` para um Chrome/Chromium (ex.: `BROWSER=/usr/bin/chromium node scripts/ui-test.mjs`). Também há `lfg-test`, `polls-test`, `clips-test`, `remote-test`, `callinvite-test`, `extras-test`, `themes-test`, `lite-test`, `activity-test`, `activity-ui-test`, `steam-test` (sobem o próprio servidor) e `fase2-test` (usa `API`, padrão `http://localhost:3000`).

## Limitações conhecidas
Sem o SFU (RTC=0 ou mediasoup indisponível) a voz cai para malha P2P, boa até ~6-8 pessoas por sala. Push-to-talk e atalhos de som só com o app em foco (global: mutar/ensurdecer). Sem threads, bots ou criptografia de ponta a ponta.
