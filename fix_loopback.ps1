# ============================================
# FH6 Loopback Fix - Run as Administrator!
# ============================================
# This script fixes the UWP Network Isolation issue
# that prevents Forza Horizon 6 (MS Store/Xbox version)
# from sending UDP packets to localhost (127.0.0.1).
#
# NOT NEEDED for Steam version.
# ============================================

Write-Host ""
Write-Host "=== FH6 Loopback Fix ===" -ForegroundColor Cyan
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[ERROR] This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell -> Run as Administrator" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# Find Forza Horizon 6 package
Write-Host "Searching for Forza Horizon 6 packages..." -ForegroundColor Yellow
$packages = Get-AppxPackage | Where-Object { $_.Name -match "forza|horizon" -or $_.Name -match "624F8B84B80|SunriseBaseGame|ForzaHorizon" }

if ($packages.Count -eq 0) {
    Write-Host "[WARNING] No Forza packages found automatically." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Listing ALL packages for manual search:" -ForegroundColor Cyan
    Get-AppxPackage | Select-Object Name, PackageFamilyName | Format-Table -AutoSize
    Write-Host ""
    $manualName = Read-Host "Enter the PackageFamilyName for FH6 manually"
    if ($manualName) {
        CheckNetIsolation.exe LoopbackExempt -a -n="$manualName"
        Write-Host "[OK] Loopback exemption added for: $manualName" -ForegroundColor Green
    }
} else {
    foreach ($pkg in $packages) {
        Write-Host "Found: $($pkg.Name)" -ForegroundColor Green
        Write-Host "  PackageFamilyName: $($pkg.PackageFamilyName)" -ForegroundColor Gray
        CheckNetIsolation.exe LoopbackExempt -a -n="$($pkg.PackageFamilyName)"
        Write-Host "  [OK] Loopback exemption added!" -ForegroundColor Green
        Write-Host ""
    }
}

# Also add a firewall rule for the UDP port
Write-Host "Adding firewall rule for UDP port 20127..." -ForegroundColor Yellow
$ruleName = "FH6 Telemetry UDP"
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
    Remove-NetFirewallRule -DisplayName $ruleName
}
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol UDP -LocalPort 20127 -Action Allow | Out-Null
Write-Host "[OK] Firewall rule added for UDP port 20127" -ForegroundColor Green

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Cyan
Write-Host "Now restart both FH6 and server.py" -ForegroundColor Yellow
Write-Host ""
Read-Host "Press Enter to exit"
