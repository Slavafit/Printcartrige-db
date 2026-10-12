param([string]$DotNet = '')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$localDotNet = Join-Path $root '.dotnet-sdk\dotnet.exe'
if (-not $DotNet) { $DotNet = if (Test-Path $localDotNet) { $localDotNet } else { (Get-Command dotnet.exe -ErrorAction Stop).Source } }
$output = Join-Path $root 'release-lightweight'
$package = Join-Path $output 'PrinterDB'
$app = Join-Path $package 'app'
if (-not (Test-Path -LiteralPath $DotNet)) { throw "dotnet SDK not found: $DotNet" }
if (Test-Path -LiteralPath $output) {
  $resolved = (Resolve-Path -LiteralPath $output).Path
  if ($resolved -ne (Join-Path $root 'release-lightweight')) { throw 'Unexpected output path' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $app | Out-Null

Push-Location $root
try {
  pnpm.cmd mvp:seed
  if ($LASTEXITCODE -ne 0) { throw 'mvp:seed failed' }
  pnpm.cmd build
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
  & $DotNet publish launcher\PrinterDB.Launcher\PrinterDB.Launcher.csproj -c Release -r win-x64 --self-contained true -o (Join-Path $output 'launcher')
  if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }
  Copy-Item (Join-Path $output 'launcher\PrinterDB.exe') (Join-Path $package 'PrinterDB.exe')

  pnpm.cmd exec esbuild src\web-server.ts --bundle --platform=node --target=node22 --format=cjs --external:better-sqlite3 --outfile="$app\server.cjs"
  if ($LASTEXITCODE -ne 0) { throw 'server bundle failed' }
  Copy-Item (Get-Command node.exe).Source (Join-Path $app 'node.exe')
  Copy-Item mvp.sqlite (Join-Path $app 'seed.sqlite')
  Copy-Item web-dist (Join-Path $app 'web-dist') -Recurse

  $modules = Join-Path $app 'node_modules'
  New-Item -ItemType Directory -Force -Path $modules | Out-Null
  $resolvedJson = node -e "const m=require('module');const better=require.resolve('better-sqlite3/package.json');const bindings=m.createRequire(better).resolve('bindings/package.json');const fileUri=m.createRequire(bindings).resolve('file-uri-to-path/package.json');console.log(JSON.stringify({better,bindings,fileUri}))"
  $resolved = $resolvedJson | ConvertFrom-Json
  foreach ($entry in @(@{Name='better-sqlite3';Manifest=$resolved.better}, @{Name='bindings';Manifest=$resolved.bindings}, @{Name='file-uri-to-path';Manifest=$resolved.fileUri})) {
    Copy-Item (Split-Path $entry.Manifest -Parent) (Join-Path $modules $entry.Name) -Recurse
  }
  $nodeLicense = Join-Path (Split-Path (Get-Command node.exe).Source -Parent) 'LICENSE'
  if (Test-Path $nodeLicense) { Copy-Item $nodeLicense (Join-Path $app 'NODE-LICENSE.txt') }
  Remove-Item -LiteralPath (Join-Path $output 'launcher') -Recurse -Force

  $bytes = (Get-ChildItem $package -File -Recurse | Measure-Object Length -Sum).Sum
  [pscustomobject]@{ Output = $package; Bytes = $bytes; MiB = [math]::Round($bytes / 1MB, 1) } | Format-List
}
finally { Pop-Location }
