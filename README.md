# LocalCord

Chat + voz + vídeo + transmissão de tela auto-hospedado, com layout inspirado no Discord. O servidor roda em Linux/Umbrel/Docker; os amigos usam o **aplicativo desktop** (Windows) ou o navegador, conectados pela VPN (Tailscale / Hamachi / Radmin). Não usa código nem assets do Discord.

## Recursos
- **Servidores:** categorias, canais de texto e de voz (com chat ao lado), convites gerenciáveis, cargos com permissões, apelido por servidor, ícone/banner/descrição/cor, **emojis personalizados** (`:nome:`), **soundboard do servidor**, mensagem de boas-vindas, reordenar canais, transferir propriedade, notificações por servidor/canal.
- **Mensagens:** markdown, respostas, edição, fixadas, reações (inclusive emoji do servidor), menções, anexos, pré-visualização de imagens de links, busca, "digitando…", não lidas.
- **Perfil:** avatar e banner (imagem/GIF), cor, pronomes, status com emoji, bio, prévia ao vivo.
- **Social:** DMs, amigos, bloqueio, privacidade de pedidos, **chamadas de voz/vídeo em DM** com toque.
- **Voz:** WebRTC P2P; redução de ruído por IA (RNNoise e GTCRN, trocáveis ao vivo), porta de ruído, eco, ganho, taxa de bits, push-to-talk, volume por usuário, teste de microfone, latência.
- **Painéis rápidos (barra do usuário):** ▾ do microfone troca **dispositivo de entrada**, modo de ruído, **eco**, porta de ruído, ganho e volume; ▾ do fone troca **dispositivo de saída** e volumes; clicar no seu nome muda **status** (online/ausente/não perturbe/invisível) e status personalizado.
- **Sons:** efeito sonoro para silenciar, ensurdecer, entrar/sair da chamada (você e os outros), câmera, começar/parar transmissão, mensagens, menções, chamada recebida e amizade; cada um liga/desliga, tem volume, teste e opção de **trocar pelo seu próprio áudio**.
- **Soundboard:** sons pessoais (ficam na conta) e dos servidores, tocados para toda a sala de voz; favoritos, volume, silenciar, escolher quais servidores usar e **atalho de teclado por som**.
- **Transmissão de tela:** escolha de tela/janela com miniaturas ao vivo, 720p/1080p/1440p/original, 15/30/60 fps, otimização movimento/nitidez, áudio do sistema, e **mudança de qualidade/fonte durante a transmissão**.
- **Configurações:** Conta (usuário, senha, excluir conta), Perfil, Privacidade e segurança (sessões), Aparência (4 temas, cor, fonte, espaçamento, arredondamento, 12/24h), Acessibilidade, Voz e vídeo, Transmissão, Sons, Soundboard, Notificações, Atalhos configuráveis, Avançado (exportar/importar, modo desenvolvedor). **Tudo sincroniza na conta** (menos dispositivos de áudio).
- **App desktop:** janela própria, bandeja, iniciar com o Windows, atalhos globais configuráveis, badge de não lidas, aceleração de hardware, limpar cache.

## Servidor
Requer Node.js >= 22.5 (usa `node:sqlite`) e `openssl`. No Docker/Umbrel já vem no `Dockerfile`.

    npm install --omit=dev
    npm start            # HTTP :3000 e HTTPS :3443

Variáveis: `PORT`, `HTTPS_PORT`, `HOST`, `DATA_DIR`, `MAX_UPLOAD_MB`, `OPEN_REGISTRATION=0`, `HTTPS=0`, `TLS_KEY`/`TLS_CERT`, `TLS_SAN=IP:<ip-vpn>`, `TURN_URL`/`TURN_USER`/`TURN_PASS`.

Docker: `docker build -t localcord . && docker run -d --restart=always -p 3000:3000 -p 3443:3443 -v ~/localcord-data:/data -e TLS_SAN=IP:<ip-vpn> localcord`
Atualizar: reconstrua a imagem e recrie o container com o mesmo volume (o banco migra sozinho).

## Aplicativo desktop (Windows)
Instaladores em `desktop/dist/`: `LocalCord-Setup-<versão>.exe` e `LocalCord-Portable-<versão>.exe`. No primeiro uso o app pede o endereço do servidor (IP da VPN). Regerar: `cd desktop && npm install && npm run dist`.

## Testes
    BASE=http://localhost:3000 node scripts/e2e.mjs   # API + gateway + voz + soundboard + conta
    node scripts/ui-test.mjs                          # navegador real: 2 usuários, WebRTC, RNNoise, sons, painéis, configurações
    node scripts/desktop-test.mjs                     # app Electron
    node scripts/desktop-share-test.mjs               # Electron transmitindo a tela real para outro usuário

## Limitações conhecidas
Voz em malha P2P (bom até ~6-8 pessoas por sala). Push-to-talk e atalhos de som só com o app em foco (global: mutar/ensurdecer). Sem threads, bots ou criptografia de ponta a ponta.
