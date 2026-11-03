# Fase 3 — Controle remoto (mouse e teclado)

Data: 2026-11-03. Escopo desta etapa: **só mouse e teclado**. Controle de videogame (gamepad virtual) fica para depois.

## Como funciona para quem usa
1. Na sala de voz, quem **assiste** a uma transmissão clica no ícone de cursor nos botões da transmissão em destaque ("Pedir controle").
2. Quem **transmite** (no app para Windows, transmitindo a **tela inteira**) vê um diálogo: "bob quer controlar seu PC", com caixas **Mouse** e **Teclado**, e escolhe o que libera. O pedido expira em 30 s.
3. Aceito, quem assiste clica dentro da transmissão (borda vermelha) para controlar: movimento, clique (esquerdo/meio/direito), arrastar, rolagem e, se liberado, teclado. Clicar fora da transmissão devolve o teclado ao próprio app.
4. Para parar: botão **Parar** no aviso (dos dois lados), **Ctrl+Alt+Shift+Q** no teclado físico do dono, sair da sala, desconectar ou parar de transmitir.

## Arquitetura
```
quem assiste (navegador/app)      servidor (gateway WS)              dono (app desktop Windows)
  captura no quadro do vídeo  ->  server/remote.js valida, filtra  ->  public/remote.js (renderer)
  coordenadas 0..1, códigos       por permissão, limita taxa          -> IPC -> desktop/remote.js (main)
  de tecla físicos (KeyA...)      só da conexão que está na sala       -> stdin -> native/lc-input.exe -> SendInput
```
- **server/remote.js**: pedido → consentimento → sessão ativa → fim. Uma sessão por pessoa (como dono ou controlador). Eventos aceitos: `m` (x,y em 0..1), `d`/`u` (botão 0–2), `w` (rolagem, ±2400 em unidades do Windows), `kd`/`ku` (`KeyboardEvent.code`, `^[A-Za-z][A-Za-z0-9]{0,23}$`). Campos extras são removidos. Máx. 64 eventos por mensagem; balde de 400 eventos/s com folga de 800. Teclas são descartadas se o teclado não foi liberado (o mesmo para o mouse). Pedido, resposta e comandos só valem vindos da conexão WebSocket que está na chamada.
- **public/remote.js**: botão no quadro, diálogo de consentimento, captura (fase de captura, `preventDefault`, mapeamento descontando as faixas pretas do `object-fit: contain`), fila com movimento agrupado a cada 16 ms, solta teclas/botões ao clicar fora ou perder o foco, aviso fixo no topo (`#remote-chip`) para os dois lados. Sem o app desktop, o pedido é recusado automaticamente com explicação (o navegador nunca pode ser controlado).
- **desktop/remote.js**: guarda a fonte transmitida (`setDisplayMediaRequestHandler`), calcula o retângulo do monitor em pixels físicos (`screen.dipToScreenRect`), inicia o `lc-input.exe` só quando a sessão é aceita, e abre uma **janela de aviso sempre no topo** (nível `screen-saver`, sem foco, sem JavaScript; o botão Parar é um link interceptado pelo processo principal). Fechar o aviso também para.
- **native/lc-input** (Rust): lê linhas JSON da entrada padrão (`arm` com o retângulo, `disarm`, `ev`), valida de novo, injeta com `SendInput` por **scancode** (a tecla sai igual à do teclado físico do dono, inclusive ABNT2: Ç = `Semicolon`, `/?` = `IntlRo`), só dentro do monitor transmitido, com DPI por monitor. Atalho de emergência por gancho `WH_KEYBOARD_LL` que **ignora entrada injetada** (`LLKHF_INJECTED`): quem controla não consegue acioná-lo nem bloqueá-lo. Ao desarmar, no atalho ou se o app fechar (fim da entrada padrão), solta toda tecla/botão pressionado. Sem porta de rede.

## Segurança (requisitos da Fase 0 e como foram atendidos)
| Requisito | Onde |
|---|---|
| Sessão criada no servidor com dono, controlador e permissões separadas | `server/remote.js` |
| Consentimento explícito no cliente do dono | diálogo em `public/remote.js`; o servidor só ativa com `REMOTE_ANSWER` do dono |
| Comandos validados no servidor (autor, formato, faixa, tamanho, taxa) | `cleanEvent` + balde de taxa |
| Revogação imediata | `REMOTE_STOP` dos dois lados; aviso nativo; atalho físico |
| Encerra ao sair da chamada / fechar transmissão / desconectar | `onLeave`, `onScreenOff`, `leaveVoice` |
| Indicador permanente não ocultável | janela sempre no topo do processo principal + aviso no app |
| Atalho de emergência no processo nativo | `lc-input` (gancho de baixo nível, só teclado físico) |
| Entrada aplicada só pelo processo nativo | o renderer nunca simula eventos; `lc-input` só injeta armado |

## Limitações conhecidas
- **Só a tela inteira**: transmitindo uma janela, o pedido é recusado com a explicação (mapear a janela fica para depois).
- **Janelas de administrador** (UAC) não recebem a entrada injetada (regra do Windows, UIPI). O dono vê um aviso quando isso acontece.
- **Jogos com anti-cheat** podem ignorar ou bloquear entrada injetada.
- **Ctrl+Alt+Del** não pode ser injetado (o Windows não permite).
- Latência: os comandos passam pelo servidor (VPN). Bom para ajudar alguém; para jogar remoto, medir antes.
- O cursor de quem controla é o do vídeo (o cursor do dono aparece na transmissão).

## Build
- O `desktop/native/lc-input.exe` está no repositório, compilado no Linux com `cargo build --release --target x86_64-pc-windows-gnu` em `native/lc-input` (só usa DLLs do Windows). `npm run dist` (desktop) chama `build-native.mjs`: com Rust no Windows, recompila; sem Rust, usa o incluído. O electron-builder copia para `resources/lc-input.exe`.
- Desktop **1.0.15**.

## Testes
- `cargo test` em `native/lc-input`: 9 testes (mapa de teclas sem repetição, estendidas, ABNT2, protocolo, limites, coordenadas em monitor à esquerda).
- `node scripts/remote-test.mjs`: 45 verificações — 22 do módulo do servidor (recusas, consentimento, permissões, validação, taxa, expiração, fim automático) e 23 com três navegadores reais (ponte do app desktop simulada que registra o que seria injetado): pedido, diálogo, só-mouse, posição normalizada, clique, rolagem, teclas na ordem com Shift, teclado que não vaza para o chat, tecla segurada solta ao clicar fora, atalho de emergência, botão Parar, dono no navegador comum (recusa automática), dono parando de transmitir.
- **Não testado aqui** (sem Windows): a injeção real (`SendInput`), o gancho do atalho e a janela de aviso do Electron. Roteiro manual abaixo.

## Roteiro de teste manual (2 PCs, app 1.0.15 no PC que será controlado)
1. PC A (app desktop) entra na sala e transmite a **tela inteira**. PC B (app ou navegador) entra e abre a transmissão.
2. B clica no ícone de cursor → A vê o diálogo; libere só o **mouse** → B move e clica: o cursor de A obedece; B digita: nada acontece em A.
3. Pare e peça de novo liberando **mouse e teclado**: abra o Bloco de Notas em A; B digita "ação ç /?": o texto sai certo no ABNT2.
4. Em A, aperte **Ctrl+Alt+Shift+Q**: o aviso vermelho some, B é avisado. Repita e use o botão **Parar** do aviso; repita e pare de transmitir.
5. Com a sessão ativa, B segura uma tecla e A aperta Ctrl+Alt+Shift+Q: a tecla não fica presa em A.
6. Em A, abra um programa como administrador e dê foco a ele: B não consegue clicar nele e A vê o aviso do Windows.
7. Com dois monitores em A, transmita o segundo: os cliques de B caem no monitor certo.
