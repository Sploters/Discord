# Teste de FPS do capturador de tela nativo do Windows (LocalCord). Nao altera nada no PC.
$ErrorActionPreference = 'Continue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir
$out = Join-Path $dir 'resultado.txt'
# aberto de dentro do .zip, o Windows roda numa pasta temporaria: o resultado iria para la
if ($dir -like "$env:TEMP*" -or -not (Test-Path (Join-Path $dir 'captura.exe'))) {
  Write-Host ''
  Write-Host '  Parece que a pasta nao foi extraida do .zip.' -ForegroundColor Yellow
  Write-Host '  Feche esta janela, clique com o botao direito no .zip > Extrair tudo, e rode o TESTAR da pasta extraida.'
  Read-Host '  Enter para sair'; exit 1
}
$prof = Join-Path $env:TEMP 'localcord-teste-fps'
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Host 'Microsoft Edge nao encontrado.'; Read-Host 'Enter para sair'; exit 1 }

$hz = (Get-CimInstance Win32_VideoController | Where-Object CurrentRefreshRate | Select-Object -First 1).CurrentRefreshRate
Write-Host ''
Write-Host '  TESTE DE FPS DA CAPTURA DE TELA' -ForegroundColor Cyan
Write-Host "  Monitor: $hz Hz. Leva cerca de 1 minuto e meio."
Write-Host '  Vai abrir uma animacao colorida em tela cheia: NAO mexa no mouse nem no teclado ate ela fechar.'
Write-Host ''
Write-Host "  O resultado sera salvo em: $out"
Write-Host ''
Read-Host '  Feche jogos e videos e aperte Enter para comecar'

# esta janela sai da frente: a captura tem que ver a animacao, nao o console
Add-Type -Name Win -Namespace LC -MemberDefinition '[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);' -ErrorAction SilentlyContinue
function Janela($modo) { try { [LC.Win]::ShowWindow([LC.Win]::GetConsoleWindow(), $modo) | Out-Null } catch { } }
Janela 6  # minimizar
$url = ([System.Uri](Join-Path $dir 'animacao.html')).AbsoluteUri  # codifica espacos e acentos do caminho
Start-Process $edge -ArgumentList @('--kiosk', $url, '--edge-kiosk-type=fullscreen', '--no-first-run', "--user-data-dir=$prof", '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows')
Start-Sleep 6

$testes = @(
  @{ nome = 'WGC padrao';            args = @('--secs', '15', '--verify', '1') },
  @{ nome = 'WGC sem limite';        args = @('--secs', '15', '--verify', '1', '--min-interval-ms', '0') },
  @{ nome = 'WGC sem limite/borda';  args = @('--secs', '15', '--verify', '1', '--min-interval-ms', '0', '--border', '0') },
  @{ nome = 'DXGI (comparacao)';     args = @('--secs', '15', '--api', 'dxgi') }
)
function Salvar { try { $linhas | Set-Content -Encoding UTF8 $out } catch { Write-Host "  Nao consegui salvar em $out : $($_.Exception.Message)" -ForegroundColor Red } }
$linhas = @("LocalCord - teste de FPS da captura nativa", "Data: $(Get-Date -Format 'yyyy-MM-dd HH:mm')", "Monitor: $hz Hz", "GPU: $((Get-CimInstance Win32_VideoController | Select-Object -First 1).Name)", "Windows: $((Get-CimInstance Win32_OperatingSystem).Caption) $((Get-CimInstance Win32_OperatingSystem).BuildNumber)", '')
Salvar
$i = 0
foreach ($t in $testes) {
  $i++; Write-Host "  teste $i de $($testes.Count): $($t.nome)..."
  try {
    $raw = & (Join-Path $dir 'captura.exe') @($t.args) 2>&1 | Out-String
    $r = @{}; foreach ($l in ($raw -split "`n" | Where-Object { $_.Trim().StartsWith('{') })) { ($l | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $r[$_.Name] = $_.Value } }
    $resumo = '{0,-22} media {1,6} fps | unicos {2,6} fps | pior segundo {3} | mediana {4}' -f $t.nome, $r.meanFps, $(if ($r.verify) { $r.uniqueFps } else { '-' }), $r.perSecMin, $r.perSecMedian
  } catch { $resumo = "{0,-22} ERRO: {1}" -f $t.nome, $_.Exception.Message; $raw = '' }
  $linhas += $resumo; $linhas += "  bruto: $($raw.Trim() -replace "`r?`n", ' ')"
  Salvar  # salva a cada teste: se algo der errado depois, o que ja foi medido fica
}
# fecha so a janela da animacao (perfil proprio); erro aqui nunca impede o resultado
try { Get-CimInstance Win32_Process -Filter "name='msedge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*localcord-teste-fps*' } | ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null } } catch { }
Janela 9  # restaurar
# a animacao muda todo quadro: se a captura viu quase so quadros repetidos, ela nao estava visivel na tela
$baixo = $linhas | Where-Object { $_ -match '^WGC.*unicos\s+([\d,\.]+) fps' -and [double]($Matches[1] -replace ',', '.') -lt 20 }
if ($baixo) {
  $linhas += ''
  $linhas += 'AVISO: quase todos os quadros capturados eram iguais - a animacao provavelmente nao estava visivel durante o teste.'
}
Salvar
Write-Host ''
if ($baixo) { Write-Host '  ATENCAO: a animacao nao parecia estar na tela durante o teste.' -ForegroundColor Yellow; Write-Host '  Ela apareceu em tela cheia? Conte isso ao Claude junto com o resultado.' -ForegroundColor Yellow; Write-Host '' }
$linhas | Where-Object { $_ -notlike '  bruto:*' } | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host "  Pronto! Resultado salvo em: $out" -ForegroundColor Green
Write-Host '  Copie o conteudo desse arquivo e cole na conversa com o Claude.'
Read-Host '  Enter para sair'
