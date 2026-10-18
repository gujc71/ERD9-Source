param(
	[string]$Path,          # file name to enter in the dialog (empty: cancel)
	[string]$Out = "",      # capture the dialog to this PNG first
	[int]$TimeoutSec = 15
)
# Drives the native file dialog (Save / Open) of erd9.exe without keyboard focus:
# waits for it, captures it, sets the file name (WM_SETTEXT) and presses Save / Open (IDOK).
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class FD {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, string l);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }

  static string ClassOf(IntPtr h) { var s = new StringBuilder(64); GetClassName(h, s, 64); return s.ToString(); }

  /// visible common dialog (#32770) of the process
  public static IntPtr FindDialog(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => {
      uint wp; GetWindowThreadProcessId(h, out wp);
      if (wp == pid && IsWindowVisible(h) && ClassOf(h) == "#32770") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  /// the Edit inside the file name combo box
  public static IntPtr FindFileNameBox(IntPtr dialog) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(dialog, (h, p) => {
      if (ClassOf(h) != "Edit") return true;
      for (IntPtr a = GetParent(h); a != IntPtr.Zero && a != dialog; a = GetParent(a)) {
        string c = ClassOf(a);
        if (c == "ComboBox" || c == "ComboBoxEx32") { found = h; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static void SetText(IntPtr h, string text) { SendMessage(h, 0x000C, IntPtr.Zero, text); }   // WM_SETTEXT
  public static void Command(IntPtr dialog, int id) { PostMessage(dialog, 0x0111, (IntPtr)id, IntPtr.Zero); }  // WM_COMMAND
}
"@
[FD]::SetProcessDPIAware() | Out-Null
$proc = Get-Process erd9 | Select-Object -First 1
$h = [IntPtr]::Zero
for ($i = 0; $i -lt $TimeoutSec * 4 -and $h -eq [IntPtr]::Zero; $i++) {
	Start-Sleep -Milliseconds 250
	$h = [FD]::FindDialog([uint32]$proc.Id)
}
if ($h -eq [IntPtr]::Zero) { throw "file dialog not found" }
Start-Sleep -Milliseconds 1000

if ($Out) {
	$r = New-Object FD+RECT
	[FD]::GetWindowRect($h, [ref]$r) | Out-Null
	$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
	$g = [System.Drawing.Graphics]::FromImage($bmp)
	$hdc = $g.GetHdc()
	[FD]::PrintWindow($h, $hdc, 2) | Out-Null
	$g.ReleaseHdc($hdc)
	$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
}

if ($Path) {
	$box = [FD]::FindFileNameBox($h)
	if ($box -eq [IntPtr]::Zero) { throw "file name box not found" }
	[FD]::SetText($box, $Path)
	Start-Sleep -Milliseconds 300
	[FD]::Command($h, 1)     # IDOK: Save / Open
} else {
	[FD]::Command($h, 2)     # IDCANCEL
}
"ok"
