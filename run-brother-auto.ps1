$ErrorActionPreference = "Stop"
$env:BROTHER_LIMIT = "20"

$maxBatches = 50
$noProgressLimit = 2

$noProgress = 0

try {
    for ($i = 1; $i -le $maxBatches; $i++) {

        Write-Host "`n========== BROTHER BATCH $i ==========" -ForegroundColor Cyan

        $before = (Get-Content ".\data\brother-compatibility.json" -Raw |
            ConvertFrom-Json).supplies.Count

		node .\scripts\collect-brother.cjs

        if ($LASTEXITCODE -ne 0) {
            Write-Host "шибка выполнения. становка." -ForegroundColor Red
            break
        }

        $report = Get-Content ".\data\brother-collection-report.json" -Raw |
            ConvertFrom-Json

        if ($report.stoppedByAccessRestriction -eq $true) {
            Write-Host "Сайт ограничил доступ. становка." -ForegroundColor Yellow
            break
        }

        $after = (Get-Content ".\data\brother-compatibility.json" -Raw |
            ConvertFrom-Json).supplies.Count

        $added = $after - $before

        Write-Host "обавлено расходников: $added"
        Write-Host "сего расходников: $after"

        if ($added -le 0) {
            $noProgress++
        } else {
            $noProgress = 0
        }

        if ($noProgress -ge $noProgressLimit) {
            Write-Host "ет прогресса две партии подряд. становка." -ForegroundColor Yellow
            break
        }

        Start-Sleep -Seconds 10
    }
}
finally {
    Remove-Item Env:BROTHER_LIMIT -ErrorAction SilentlyContinue
    Write-Host "`nСбор Brother завершён." -ForegroundColor Green
}
