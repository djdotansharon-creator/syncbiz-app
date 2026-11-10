/**
 * The self-update window (owner 2026-11-02): a small WHITE card with rounded corners — no frame, no percentage — "VONO" with the version beside it and one
 * black bar that keeps moving. It must stay on the desktop while the player itself is gone (hidden, then stopped by the installer), exactly like a normal
 * app updater, so it cannot live inside the player's process: it is a separate, tiny, hidden-console PowerShell + WPF window (nothing to ship, nothing to
 * install). It closes when the player writes the cancel file (the update failed before the installer started), when the NEW player's window appears, or
 * after a 5-minute safety limit. If it cannot start, the update still works — the caller then simply keeps the player visible.
 * Pure strings here — no Electron — so the shape is testable on any machine; the real window is proven only on Windows.
 */

export const SPLASH_SAFETY_SECONDS = 300;
/** the process names the installed player can have (current exe + the planned VONO names) */
export const PLAYER_PROCESS_NAMES = ["SyncBiz Player", "VONO", "VONO Player"] as const;

/** the script written to disk and run with: powershell.exe -STA -File <script> -Version <v> -OldPid <pid> -Cancel <file> */
export function splashScript(): string {
  return `param([string]$Version, [int]$OldPid, [string]$Cancel)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
  $xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent" ResizeMode="NoResize" ShowInTaskbar="False"
        Topmost="True" WindowStartupLocation="CenterScreen" Width="340" Height="112" ShowActivated="False" Focusable="False">
  <Border x:Name="Card" Background="White" CornerRadius="18" Padding="26,22,26,22" RenderTransformOrigin="0.5,0.5" Opacity="0">
    <Border.RenderTransform><ScaleTransform x:Name="Scale" ScaleX="0.9" ScaleY="0.9"/></Border.RenderTransform>
    <StackPanel VerticalAlignment="Center">
      <StackPanel Orientation="Horizontal">
        <TextBlock Text="VONO" FontFamily="Segoe UI" FontSize="22" FontWeight="ExtraBold" Foreground="#111111"/>
        <TextBlock x:Name="Ver" FontFamily="Segoe UI" FontSize="14" FontWeight="SemiBold" Foreground="#80111111" Margin="10,8,0,0"/>
      </StackPanel>
      <Border Height="4" CornerRadius="2" Background="#14000000" Margin="0,16,0,0" ClipToBounds="True">
        <Canvas><Border x:Name="Seg" Width="110" Height="4" CornerRadius="2" Background="#111111" Canvas.Left="-120"/></Canvas>
      </Border>
    </StackPanel>
  </Border>
</Window>
'@
  $script:win = [System.Windows.Markup.XamlReader]::Parse($xaml)
  $script:win.FindName('Ver').Text = $Version
  $card = $script:win.FindName('Card'); $scale = $script:win.FindName('Scale'); $seg = $script:win.FindName('Seg')
  $ease = New-Object System.Windows.Media.Animation.CubicEase
  $ease.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseOut
  $pop = New-Object System.Windows.Media.Animation.DoubleAnimation(0.9, 1.0, [TimeSpan]::FromMilliseconds(320))
  $pop.EasingFunction = $ease
  $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleXProperty, $pop)
  $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleYProperty, $pop)
  $fade = New-Object System.Windows.Media.Animation.DoubleAnimation(0.0, 1.0, [TimeSpan]::FromMilliseconds(260))
  $card.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fade)
  $run = New-Object System.Windows.Media.Animation.DoubleAnimation(-120.0, 300.0, [TimeSpan]::FromMilliseconds(1150))
  $run.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
  $inout = New-Object System.Windows.Media.Animation.QuadraticEase
  $inout.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseInOut
  $run.EasingFunction = $inout
  $seg.BeginAnimation([System.Windows.Controls.Canvas]::LeftProperty, $run)
  $script:started = Get-Date
  $script:seen = 0
  $script:cancelFile = $Cancel
  $script:oldPid = $OldPid
  $script:names = @(${PLAYER_PROCESS_NAMES.map((n) => `'${n}'`).join(", ")})
  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds(500)
  $timer.Add_Tick({
    try {
      if ($script:cancelFile -and (Test-Path -LiteralPath $script:cancelFile)) { $script:win.Close(); return }
      if (((Get-Date) - $script:started).TotalSeconds -gt ${SPLASH_SAFETY_SECONDS}) { $script:win.Close(); return }
      if (-not (Get-Process -Id $script:oldPid -ErrorAction SilentlyContinue)) {
        $fresh = Get-Process -Name $script:names -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Id -ne $script:oldPid }
        if ($fresh) { $script:seen++ } else { $script:seen = 0 }
        if ($script:seen -ge 3) { $script:win.Close() }
      }
    } catch { }
  })
  $timer.Start()
  $script:win.ShowDialog() | Out-Null
} catch { exit 0 }
`;
}
