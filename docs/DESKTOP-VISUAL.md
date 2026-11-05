# App desktop: tela cheia com defeito, texto borrado e ícone da barra de tarefas

Data: 2026-11-03. Relatado em um PC específico (não reproduzido em outros); as correções valem para todos e não mudam nada onde já funcionava.

| Problema | Causa provável | Correção (desktop 1.0.15) |
|---|---|---|
| Tela cheia (transmissão, clipe, vídeo) com visual bugado | botões nativos da barra de título (`titleBarOverlay`) continuavam desenhados sobre a tela cheia e a janela não repintava direito ao entrar/sair; camada de GPU forçada no vídeo em tela cheia | nos eventos `enter/leave-html-full-screen`: barra de título escondida (`html.lc-fs`), botões nativos ficam pretos, repintura forçada em 0/60/300/1000 ms; `:fullscreen` sem margem, borda, transformação ou animação; no app, o vídeo da tela cheia deixa de forçar `translateZ(0)` (a sobreposição de vídeo do hardware já está desligada nas flags) |
| Letras borradas que voltam ao normal depois de alguns segundos | o Chromium pinta primeiro uma versão em baixa resolução da página e só depois a nítida; em algumas placas/drivers a troca demora | `--disable-low-res-tiling` sempre; repintura forçada ao mostrar, restaurar, maximizar, mover entre monitores, ganhar foco e mudar a escala do Windows |
| Placas/drivers antigos (ex.: Intel HD 4000) | rasterização na GPU instável | **Compatibilidade de vídeo** (Configurações → Aplicativo): `--disable-gpu-rasterization`, `--disable-zero-copy`, `--disable-gpu-memory-buffer-video-frames`. "Automático" liga sozinho em Intel anteriores à Broadwell (ID < 0x1600), detectado na abertura anterior; "Ligada"/"Desligada" forçam. Mostra a placa e se está ativa agora; mudar oferece reiniciar o app |
| Ícone em branco/ausente na barra de tarefas | só havia PNG (512 px) como ícone da janela, criada escondida | `build/icon.ico` com 16, 20, 24, 32, 40, 48, 64, 128 e 256 px (gerado por `make-icon.mjs`), usado na janela e no executável; ícone reaplicado em `ready-to-show` |

Diagnóstico: o `main.log` (pasta de dados do app) registra a placa detectada, o driver e se a compatibilidade está ativa (`gpu … antiga … compat ativa …`).

Se o ícone continuar em branco depois de atualizar, pode ser o cache de ícones do Windows: desafixe a Resenha da barra de tarefas, feche o app e abra pelo menu Iniciar (ou reinicie o Windows).

## Clipe/vídeo em tela cheia escuro, com cores estouradas (desktop 1.0.16)

Sintoma: fora da tela cheia o clipe aparece normal; em tela cheia fica quase preto, só com vermelhos e azuis fortes.

Causa provável: quando o próprio `<video>` vai para tela cheia, o Chromium no Windows entrega o vídeo direto para a placa
(sobreposição de hardware / swap chain de tela cheia) e o driver pode aplicar realce automático (RTX Video Super
Resolution/HDR da NVIDIA, Intel VSR) ou converter a cor errado.

Correções:
- **Página:** clipes do chat e da galeria usam `fsVideo()` (util.js): o botão nativo de tela cheia some
  (`controlslist="nofullscreen"`) e quem entra em tela cheia é a caixa em volta do vídeo (botão no canto, duplo clique
  ou tecla F). O vídeo continua sendo desenhado junto com a página. Vale também no navegador.
- **App desktop:** recursos desligados: `DirectCompositionVideoSwapChainForFullscreen`, `NvidiaVpSuperResolution`,
  `NvidiaVpTrueHDR`, `IntelVpSuperResolution`, `DirectCompositionLetterboxVideoOptimization` e a chave
  `--disable-direct-composition-video-overlays`.
- **Compatibilidade de vídeo = Ligada** agora também decodifica vídeo pela CPU (`--disable-accelerated-video-decode`) e
  força o perfil de cor sRGB (`--force-color-profile=srgb`). Se ainda acontecer, é o próximo passo.

## Vídeo escuro e piscando só no app (no navegador normal) — desktop 1.0.19

Sintoma: no mesmo PC, o vídeo fica escuro e piscando no app desktop, mas normal no Chrome/Edge.

Conclusão: a diferença eram as opções de GPU que só o app usava (sobreposição de vídeo desligada, recursos de vídeo
NVIDIA/Intel desligados), colocadas na 1.0.16 para esse mesmo PC.

Correções:
- **Padrão = igual ao navegador:** esses desligamentos saíram do padrão e foram para **Compatibilidade de vídeo = Ligada**.
- `--force_high_performance_gpu`: em PC com vídeo integrado + placa dedicada, o app usa a dedicada.
- `main.log` registra todas as placas (qual está ativa) e o `getGPUFeatureStatus()`.

### Resultado (RTX 3080, driver 32.0.16.1088)

- A piscada acontecia **sempre que algo mudava na tela** com o vídeo tocando (controles aparecendo, contador de
  tempo a cada segundo, mensagens): o Chromium alterna entre entregar o vídeo direto à placa e desenhá-lo junto com a
  página, e no app esse segundo caminho saía escuro nessa placa. Tirar elementos de cima do vídeo não resolve
  (testado e desfeito).
- **Resolveu 100%: Compatibilidade de vídeo = Ligada** (vídeo sempre desenhado junto com a página, decodificado pela
  CPU, em sRGB). A escolha fica salva no `config.json` do app.

## Transmissão só aparece ao passar o mouse e "Assistir" não abre (desktop 1.0.21)

Com Compatibilidade de vídeo = Ligada numa RTX 3080, a janela deixava de se redesenhar sozinha: o aviso de
transmissão só aparecia ao mexer o mouse e a transmissão não abria. No navegador (e com o servidor de mídia, testado
aqui com mediasoup) tudo funciona. Causa provável: a interface desenhada pela CPU (`--disable-gpu-rasterization`,
`--disable-zero-copy`), parte do modo de compatibilidade feita para placas Intel antigas.

Correção: esses dois só entram em placas antigas (`gpuOld`); a compatibilidade em placas modernas mantém só os ajustes
de vídeo (decodificação na CPU, sRGB, sem sobreposição), que foram os que resolveram as piscadas. Repintura forçada
também quando um vídeo começa a tocar (`media-started-playing`).
