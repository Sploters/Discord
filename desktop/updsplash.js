// Instala a atualização com uma janelinha "Atualizando o Resenha…" na tela enquanto o instalador roda em silêncio.
// O app precisa fechar para os arquivos serem trocados, então a janela não pode ser do próprio app: um PowerShell
// (vem em todo Windows 10/11) abre a janela, inicia o instalador e fecha a janela quando ele termina. Com --force-run o
// instalador reabre o app já atualizado. Se o PowerShell não abrir, roda o instalador direto (sem a janela), como antes.
const { spawn } = require('node:child_process');

// janela escura e pequena no centro, com barra animada; fecha sozinha quando o instalador termina (ou em 3 min)
const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$p = Start-Process -FilePath $env:LC_SETUP -ArgumentList $env:LC_ARGS -PassThru
if (-not $p) { exit 1 }
$f = New-Object Windows.Forms.Form
$f.Text = 'Resenha'; $f.FormBorderStyle = 'None'; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true
$f.ClientSize = New-Object Drawing.Size(360, 104); $f.BackColor = [Drawing.Color]::FromArgb(43, 45, 49)
if ($env:LC_ICON -and (Test-Path $env:LC_ICON)) { $f.Icon = New-Object Drawing.Icon($env:LC_ICON) }
$t = New-Object Windows.Forms.Label
$t.Text = $env:LC_TITLE; $t.ForeColor = [Drawing.Color]::FromArgb(242, 243, 245)
$t.Font = New-Object Drawing.Font('Segoe UI', 12, [Drawing.FontStyle]::Bold); $t.SetBounds(22, 18, 320, 26)
$s = New-Object Windows.Forms.Label
$s.Text = $env:LC_SUB; $s.ForeColor = [Drawing.Color]::FromArgb(181, 186, 193)
$s.Font = New-Object Drawing.Font('Segoe UI', 9.5); $s.SetBounds(22, 46, 320, 20)
$b = New-Object Windows.Forms.ProgressBar
$b.Style = 'Marquee'; $b.MarqueeAnimationSpeed = 20; $b.SetBounds(22, 76, 316, 8)
$f.Controls.AddRange(@($t, $s, $b))
$start = Get-Date
$tm = New-Object Windows.Forms.Timer; $tm.Interval = 250
$tm.Add_Tick({ if ($p.HasExited -or ((Get-Date) - $start).TotalSeconds -gt 180) { $tm.Stop(); $f.Close() } })
# com windowsHide o Windows pode esconder a 1ª janela do processo: mostra de novo explicitamente
Add-Type -Namespace LC -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);'
$f.Add_Shown({ [void][LC.W]::ShowWindow($f.Handle, 5); $tm.Start(); $f.Activate() })
[void]$f.ShowDialog()
`;
const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');

// file = instalador; args = argumentos dele; o: { version, icon }
function installWithSplash(file, args, o = {}, log = () => { }) {
  const direct = () => { const p = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true }); p.on('error', (e) => log('instalador não abriu', e.message)); p.unref(); };
  if (process.platform !== 'win32') return direct();
  try {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, LC_SETUP: file, LC_ARGS: args.join(' '), LC_ICON: o.icon || '',
        LC_TITLE: o.version ? `Atualizando o Resenha para ${o.version}…` : 'Atualizando o Resenha…', LC_SUB: 'Leva alguns segundos. O app abre sozinho quando terminar.' },
    });
    p.on('error', (e) => { log('janela de atualização não abriu', e.message); direct(); });
    p.unref();
  } catch (e) { log('janela de atualização não abriu', e.message); direct(); }
}

module.exports = { installWithSplash };
