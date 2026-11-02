# Coloca a janela da animação de teste (título "FPSDIAG-ANIM") sempre no topo, para que as capturas vejam a animação e não outro programa.
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class FpsDiagWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static IntPtr Find(string t) { IntPtr r = IntPtr.Zero; EnumWindows((h, l) => { if (!IsWindowVisible(h)) return true; var sb = new StringBuilder(256); GetWindowText(h, sb, 256); if (sb.ToString().Contains(t)) { r = h; return false; } return true; }, IntPtr.Zero); return r; }
}
"@
$h = [FpsDiagWin]::Find("FPSDIAG-ANIM")
if ($h -eq [IntPtr]::Zero) { Write-Output "NAO_ENCONTRADA"; exit 1 }
[void][FpsDiagWin]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0003)
[void][FpsDiagWin]::SetForegroundWindow($h)
Write-Output "OK"
