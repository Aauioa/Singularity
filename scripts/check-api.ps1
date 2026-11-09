# 中转站自检：用你的 Key 批量调用几个模型，直接告诉你哪个能用、哪个是"站方没开渠道"。
# 用法：双击同目录的 check-api.cmd（会提示粘贴 Key），或
#   powershell -NoProfile -ExecutionPolicy Bypass -File check-api.ps1 -Key sk-xxx [-BaseUrl https://api.example.com/v1]
#
# 状态码含义（New API / one-api 系）：
#   200 = 真的能用
#   401 = Key 无效 / 被删
#   403 = Key 有效，但没被授权这个模型
#   404 = 地址或模型名不对
#   429 = 限流
#   5xx = 站方服务端问题（"No available channel ... under group X" = 该分组没渠道）

param(
  [string]$BaseUrl = 'https://api.example.com/v1',
  [string]$Key,
  [string[]]$Models = @(
    'gemini-3.8-flash-high',
    'gemini-3.1-flash-lite',
    'gpt-5.6-terra',
    'deepseek-v4-pro'
  )
)

if (-not $Key) { $Key = Read-Host '请粘贴 API Key（不会保存）' }
if (-not $Key) { Write-Host '没有 Key，退出' -ForegroundColor Red; exit 1 }

$BaseUrl = $BaseUrl.TrimEnd('/')
$endpoint = if ($BaseUrl -match '/chat/completions$') { $BaseUrl } else { "$BaseUrl/chat/completions" }

Write-Host ''
Write-Host "地址: $endpoint" -ForegroundColor Cyan
Write-Host "Key : $($Key.Substring(0, [Math]::Min(10, $Key.Length)))…" -ForegroundColor Cyan

# 1) 先看 /v1/models
$modelsUrl = ($endpoint -replace '/chat/completions$', '/models')
try {
  $modelsRaw = & curl.exe -s -m 20 "$modelsUrl" -H "Authorization: Bearer $Key"
  $modelsText = ($modelsRaw -join '')
  if ($modelsText -match '"data"\s*:\s*\[\s*\]') {
    Write-Host "`n[模型列表] 空 —— Key 有效但当前没有可用模型（通常是分组没配渠道）" -ForegroundColor Yellow
  } elseif ($modelsText -match '"id"\s*:\s*"([^"]+)"') {
    $ids = [regex]::Matches($modelsText, '"id"\s*:\s*"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
    Write-Host "`n[模型列表] 站点大概有 $($ids.Count) 个模型: $($ids[0..([Math]::Min(7,$ids.Count-1))] -join ', ')" -ForegroundColor Gray
  } else {
    Write-Host "`n[模型列表] 返回异常: $($modelsText.Substring(0, [Math]::Min(160, $modelsText.Length)))" -ForegroundColor Yellow
  }
} catch {
  Write-Host "`n[模型列表] 请求失败: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 2) 逐个模型试一次最小对话
$bodyFile = Join-Path $env:TEMP ("check-api-" + [guid]::NewGuid().ToString('N') + ".json")
$okModels = @()
foreach ($m in $Models) {
  $body = '{"model":"' + $m + '","messages":[{"role":"user","content":"hi"}]}'
  [System.IO.File]::WriteAllText($bodyFile, $body, (New-Object System.Text.UTF8Encoding($false)))
  $raw = & curl.exe -s -m 45 -w "`n__HTTP__%{http_code}" $endpoint -H "Content-Type: application/json" -H "Authorization: Bearer $Key" --data-binary "@$bodyFile"
  $text = ($raw -join "`n")
  $code = if ($text -match '__HTTP__(\d+)\s*$') { $matches[1] } else { 'ERR' }
  $payload = ($text -replace "`n__HTTP__\d+\s*$", '')
  $msg = if ($code -eq '200') {
    if ($payload -match '"content"\s*:\s*"((?:[^"\\]|\\.){0,60})') { $matches[1] } else { '(返回 200)' }
  } else {
    if ($payload -match '"message"\s*:\s*"([^"]{0,140})') { $matches[1] } else { $payload.Substring(0, [Math]::Min(140, $payload.Length)) }
  }
  $color = switch ($code) { '200' { 'Green' } '403' { 'Yellow' } '401' { 'Red' } default { 'Red' } }
  if ($code -eq '200') { $okModels += $m }
  Write-Host ("  [{0}] {1,-24} {2}" -f $code, $m, $msg) -ForegroundColor $color
  Start-Sleep -Milliseconds 500
}
Remove-Item $bodyFile -ErrorAction SilentlyContinue

Write-Host ''
if ($okModels.Count -gt 0) {
  Write-Host "✅ 可用的模型: $($okModels -join ', ')" -ForegroundColor Green
  Write-Host "在 App 里：协议选「自定义」→ Base URL 填 $BaseUrl → 模型填上面的名字 → Key 填同一个。" -ForegroundColor Green
} else {
  Write-Host "❌ 没有任何模型返回 200 —— 问题在站方（Key 分组没渠道 / 渠道全挂），不是 App 配置。" -ForegroundColor Red
  Write-Host "把上面带 request id 的那行原样发给站方，让他们检查该 token 的分组与渠道。" -ForegroundColor Yellow
}
