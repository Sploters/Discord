# Teste da transmissao nativa a 120 FPS (LocalCord). Nao instala nada e nao muda configuracoes do PC.
$ErrorActionPreference = 'Continue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir
$out = Join-Path $dir 'resultado.txt'
$exe = Join-Path $dir 'transmitir.exe'
if ($dir -like "$env:TEMP*" -or -not (Test-Path $exe)) {
  Write-Host ''
  Write-Host '  Parece que a pasta nao foi extraida do .zip.' -ForegroundColor Yellow
  Write-Host '  Feche esta janela, clique com o botao direito no .zip > Extrair tudo, e rode o TESTAR da pasta extraida.'
  Read-Host '  Enter para sair'; exit 1
}
$hz = (Get-CimInstance Win32_VideoController | Where-Object CurrentRefreshRate | Select-Object -First 1).CurrentRefreshRate
Write-Host ''
Write-Host '  TESTE DA TRANSMISSAO A 120 FPS' -ForegroundColor Cyan
Write-Host "  Monitor: $hz Hz"
Write-Host ''
Write-Host '  1. Abra o LocalCord e entre numa sala de voz.'
Write-Host '  2. Configuracoes > Transmissao > "Teste: transmissao a 120 FPS" > Abrir teste > Gerar codigo.'
Write-Host '     (o codigo e copiado sozinho)'
Write-Host ''
$code = ''
while ($code -notmatch '^LC120 \S+ \d+ \d+ \d+( \S+ \S+)?$') {
  $code = (Read-Host '  3. Cole o codigo aqui (botao direito do mouse cola) e aperte Enter').Trim()
  if ($code -notmatch '^LC120 \S+ \d+ \d+ \d+( \S+ \S+)?$') { Write-Host '     Codigo invalido: ele comeca com LC120. Tente de novo.' -ForegroundColor Yellow }
}

# animacao (muda a cada quadro) na metade esquerda da tela; o LocalCord fica na metade direita
Add-Type -AssemblyName System.Windows.Forms
$scr = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$prof = Join-Path $env:TEMP 'localcord-teste-120'
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$url = ([System.Uri](Join-Path $dir 'animacao.html')).AbsoluteUri
if ($edge) {
  Start-Process $edge -ArgumentList @("--app=$url", '--window-position=0,0', "--window-size=$([int]($scr.Width / 2)),$($scr.Height)", '--no-first-run', "--user-data-dir=$prof", '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows')
} else { Start-Process $url }
Write-Host ''
Write-Host '  4. Abriu uma animacao colorida na metade ESQUERDA da tela.' -ForegroundColor Cyan
Write-Host '     Coloque o LocalCord (com a janela do teste aberta) na metade DIREITA:'
Write-Host '     clique no LocalCord e aperte  Windows + seta para a direita.'
Write-Host '     Esta janela preta pode ficar atras.'
Read-Host '  5. Tudo visivel? Aperte Enter para comecar (leva 1 minuto, nao mexa no PC)'

$raw = & $exe --code $code --secs 60 --fps 120 --height 1080 --kbps 16000
$json = $raw | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1

try { Get-CimInstance Win32_Process -Filter "name='msedge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*localcord-teste-120*' } | ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null } } catch { }

$linhas = @("LocalCord - teste da transmissao nativa (lado de quem envia)", "Data: $(Get-Date -Format 'yyyy-MM-dd HH:mm')", "Monitor: $hz Hz", "GPU: $((Get-CimInstance Win32_VideoController | Select-Object -First 1).Name)", "Windows: $((Get-CimInstance Win32_OperatingSystem).Caption) $((Get-CimInstance Win32_OperatingSystem).BuildNumber)", '')
if ($json) {
  try {
    $r = $json | ConvertFrom-Json
    if ($r.error) { $linhas += "ERRO: $($r.error)" }
    else {
      $linhas += ('Capturados: {0} fps | Enviados: media {1} fps, mediana {2}, pior segundo {3} | {4} Mbps' -f $r.capturedFps, $r.sentFps, $r.sentMedian, $r.sentMin, $r.mbps)
      $linhas += ('Codificador: {0} | {1} | tempo de codificacao mediano {2} ms (p95 {3}) | descartados por codificador ocupado: {4}' -f $r.encoder, $r.size, $r.encodeMsMedian, $r.encodeMsP95, $r.skippedEncoderBusy)
      $linhas += ('Quadros-chave {0} | pedidos de reenvio {1} | pedidos de quadro-chave {2}' -f $r.keyframes, $r.nacks, $r.keyRequests)
    }
  } catch { }
  $linhas += "bruto: $json"
} else { $linhas += 'O programa nao devolveu resultado.'; $linhas += "saida: $($raw -join ' ')" }
try { $linhas | Set-Content -Encoding UTF8 $out } catch { Write-Host "  Nao consegui salvar em $out" -ForegroundColor Red }
Write-Host ''
$linhas | Where-Object { $_ -notlike 'bruto:*' } | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host "  Pronto! Resultado salvo em: $out" -ForegroundColor Green
Write-Host '  Mande para o Claude: o conteudo do resultado.txt E o resultado da janela do LocalCord (botao "Copiar resultado").'
Read-Host '  Enter para sair'
