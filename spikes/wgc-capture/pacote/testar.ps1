# Teste de FPS do capturador de tela nativo do Windows (LocalCord). Nao altera nada no PC.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir
$out = Join-Path $dir 'resultado.txt'
$prof = Join-Path $env:TEMP 'localcord-teste-fps'
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Host 'Microsoft Edge nao encontrado.'; Read-Host 'Enter para sair'; exit 1 }

$hz = (Get-CimInstance Win32_VideoController | Where-Object CurrentRefreshRate | Select-Object -First 1).CurrentRefreshRate
Write-Host ''
Write-Host '  TESTE DE FPS DA CAPTURA DE TELA' -ForegroundColor Cyan
Write-Host "  Monitor: $hz Hz. Leva cerca de 1 minuto e meio."
Write-Host '  Vai abrir uma animacao colorida em tela cheia: NAO mexa no mouse nem no teclado ate ela fechar.'
Write-Host ''
Read-Host '  Feche jogos e videos e aperte Enter para comecar'

$url = 'file:///' + ((Join-Path $dir 'animacao.html') -replace '\\', '/')
Start-Process $edge -ArgumentList @('--kiosk', $url, '--edge-kiosk-type=fullscreen', '--no-first-run', "--user-data-dir=$prof", '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows')
Start-Sleep 6

$testes = @(
  @{ nome = 'WGC padrao';            args = @('--secs', '15', '--verify', '1') },
  @{ nome = 'WGC sem limite';        args = @('--secs', '15', '--verify', '1', '--min-interval-ms', '0') },
  @{ nome = 'WGC sem limite/borda';  args = @('--secs', '15', '--verify', '1', '--min-interval-ms', '0', '--border', '0') },
  @{ nome = 'DXGI (comparacao)';     args = @('--secs', '15', '--api', 'dxgi') }
)
$linhas = @("LocalCord - teste de FPS da captura nativa", "Data: $(Get-Date -Format 'yyyy-MM-dd HH:mm')", "Monitor: $hz Hz", "GPU: $((Get-CimInstance Win32_VideoController | Select-Object -First 1).Name)", "Windows: $((Get-CimInstance Win32_OperatingSystem).Caption) $((Get-CimInstance Win32_OperatingSystem).BuildNumber)", '')
foreach ($t in $testes) {
  try {
    $raw = & (Join-Path $dir 'captura.exe') @($t.args) 2>&1 | Out-String
    $r = @{}; foreach ($l in ($raw -split "`n" | Where-Object { $_.Trim().StartsWith('{') })) { ($l | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $r[$_.Name] = $_.Value } }
    $resumo = '{0,-22} media {1,6} fps | unicos {2,6} fps | pior segundo {3} | mediana {4}' -f $t.nome, $r.meanFps, $(if ($r.verify) { $r.uniqueFps } else { '-' }), $r.perSecMin, $r.perSecMedian
  } catch { $resumo = "{0,-22} ERRO: {1}" -f $t.nome, $_.Exception.Message; $raw = '' }
  $linhas += $resumo; $linhas += "  bruto: $($raw.Trim() -replace "`r?`n", ' ')"
}
Get-CimInstance Win32_Process -Filter "name='msedge.exe'" | Where-Object { $_.CommandLine -like '*localcord-teste-fps*' } | ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
$linhas | Set-Content -Encoding UTF8 $out
Write-Host ''
$linhas | Where-Object { $_ -notlike '  bruto:*' } | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host "  Pronto! Resultado salvo em: $out" -ForegroundColor Green
Write-Host '  Copie o conteudo desse arquivo e cole na conversa com o Claude.'
Read-Host '  Enter para sair'
