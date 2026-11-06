# App desktop: atualizações, versões na call e relatórios de problema

## Atualizações (repositório pode ser privado)
- A cada mudança em `desktop/` na `main`, o GitHub Actions (`.github/workflows/desktop-release.yml`) monta o instalador
  e publica a release (número da versão escolhido sozinho).
- O servidor consulta a release com uma chave **somente leitura** e entrega aos apps (`/api/desktop/update`,
  `/desktop/download/<instalador>`). Chave: arquivo `github-token.txt` na pasta de dados (Umbrel: `~/resenha-data`)
  ou a variável `GITHUB_TOKEN`. Sem chave, só funciona com o repositório público.
- Apps a partir da 1.0.23 perguntam ao servidor; versões anteriores perguntam direto ao GitHub (só com repositório público).

## Versões na call
- Cada app desktop informa a versão ao conectar. Na sala de voz, quem está com o app desatualizado ganha um selinho
  amarelo com a versão (lista da sala e quadro da call), e quem está na sala recebe um aviso.
- **Versão mínima (opcional):** arquivo `desktop-min-version.txt` na pasta de dados (ex.: `1.0.23`) ou a variável
  `DESKTOP_MIN_VERSION`. Apps abaixo dela não entram nas calls e veem "Atualize o app para entrar na call", com o botão
  de atualizar. O chat continua funcionando. Quem usa pelo navegador não é afetado. Vale na hora (sem reiniciar).

## Relatório de problema
- Configurações → **Relatar um problema**: descrição + diagnóstico (versões, placa de vídeo, log do app desktop, estado
  da call, erros recentes da página; sem senha, token ou mensagens). Dá para ver tudo antes de enviar ou salvar em arquivo.
- Vai por **DM ao administrador da instalação**, com o `.json` anexado, e uma cópia fica em `<dados>/reports`.
  Administrador: variável `LC_ADMIN` (nome de usuário); sem ela, a conta mais antiga.
- Teste: `node scripts/appver-test.mjs`.
