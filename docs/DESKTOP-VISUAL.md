# App desktop: tela cheia com defeito, texto borrado e ícone da barra de tarefas

Data: 2026-11-03. Relatado em um PC específico (não reproduzido em outros); as correções valem para todos e não mudam nada onde já funcionava.

| Problema | Causa provável | Correção (desktop 1.0.15) |
|---|---|---|
| Tela cheia (transmissão, clipe, vídeo) com visual bugado | botões nativos da barra de título (`titleBarOverlay`) continuavam desenhados sobre a tela cheia e a janela não repintava direito ao entrar/sair; camada de GPU forçada no vídeo em tela cheia | nos eventos `enter/leave-html-full-screen`: barra de título escondida (`html.lc-fs`), botões nativos ficam pretos, repintura forçada em 0/60/300/1000 ms; `:fullscreen` sem margem, borda, transformação ou animação; no app, o vídeo da tela cheia deixa de forçar `translateZ(0)` (a sobreposição de vídeo do hardware já está desligada nas flags) |
| Letras borradas que voltam ao normal depois de alguns segundos | o Chromium pinta primeiro uma versão em baixa resolução da página e só depois a nítida; em algumas placas/drivers a troca demora | `--disable-low-res-tiling` sempre; repintura forçada ao mostrar, restaurar, maximizar, mover entre monitores, ganhar foco e mudar a escala do Windows |
| Placas/drivers antigos (ex.: Intel HD 4000) | rasterização na GPU instável | **Compatibilidade de vídeo** (Configurações → Aplicativo): `--disable-gpu-rasterization`, `--disable-zero-copy`, `--disable-gpu-memory-buffer-video-frames`. "Automático" liga sozinho em Intel anteriores à Broadwell (ID < 0x1600), detectado na abertura anterior; "Ligada"/"Desligada" forçam. Mostra a placa e se está ativa agora; mudar oferece reiniciar o app |
| Ícone em branco/ausente na barra de tarefas | só havia PNG (512 px) como ícone da janela, criada escondida | `build/icon.ico` com 16, 20, 24, 32, 40, 48, 64, 128 e 256 px (gerado por `make-icon.mjs`), usado na janela e no executável; ícone reaplicado em `ready-to-show` |

Diagnóstico: o `main.log` (pasta de dados do app) registra a placa detectada, o driver e se a compatibilidade está ativa (`gpu … antiga … compat ativa …`).

Se o ícone continuar em branco depois de atualizar, pode ser o cache de ícones do Windows: desafixe o LocalCord da barra de tarefas, feche o app e abra pelo menu Iniciar (ou reinicie o Windows).
