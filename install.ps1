# Super Jump 3D installer (Windows PowerShell 5.1+ / PowerShell 7)
# Usage:  irm https://raw.githubusercontent.com/n753951f/easygame/main/install.ps1 | iex
# Installs to C:\xampp\htdocs\easygame when XAMPP exists, otherwise to .\easygame.
# Set $env:EASYGAME_DIR to choose another folder.
& {
    $ErrorActionPreference = 'Stop'
    $repoZip = 'https://github.com/n753951f/easygame/archive/refs/heads/main.zip'

    if ($env:EASYGAME_DIR) { $target = $env:EASYGAME_DIR }
    elseif (Test-Path 'C:\xampp\htdocs') { $target = 'C:\xampp\htdocs\easygame' }
    else { $target = Join-Path (Get-Location) 'easygame' }

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('easygame-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        Write-Host "Downloading $repoZip"
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $zip = Join-Path $tmp 'easygame.zip'
        Invoke-WebRequest -Uri $repoZip -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath $tmp
        $src = Join-Path $tmp 'easygame-main'

        New-Item -ItemType Directory -Force -Path $target | Out-Null
        # Overwrites game files; an existing data\scores.json leaderboard is kept
        Get-ChildItem -Path $src -Force | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $target -Recurse -Force
        }

        Write-Host ''
        Write-Host "Installed to: $target" -ForegroundColor Green
        if ($target -like 'C:\xampp\htdocs\*') {
            Write-Host '1. Open XAMPP Control Panel and start Apache'
            Write-Host '2. Browse to http://localhost/easygame/'
        } else {
            Write-Host 'Move this folder into XAMPP htdocs, start Apache, then open http://localhost/easygame/'
        }
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}
