# UniRig SKELETON prediction only (never the skinning stage, never a torch.load with weights_only=False).
# usage: powershell -File tools/anim/unirig_skel.ps1 [-NoLock] recruit bulwark ...
# -NoLock: the caller already holds the shared GPU lock (rig_hy.mjs runs this inside its lock).
# Reads art/rig/raw/<kind>.body.glb, writes art/rig/raw/<kind>.skel.fbx.
param([switch]$NoLock, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Kinds)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
try { Start-Transcript -Path (Join-Path $repo 'art\rig\raw\unirig.log') -Force | Out-Null } catch { }
$d = $repo
while ((Split-Path -Leaf $d) -ne 'project-x' -and (Split-Path -Parent $d) -ne $d) { $d = Split-Path -Parent $d }
$lock = Join-Path (Split-Path -Parent $d) '.gpu-lock.d'
$ur = Join-Path $env:USERPROFILE 'UniRig'
$py = Join-Path $ur '.venv\Scripts\python.exe'
$raw = Join-Path $repo 'art\rig\raw'
$in = Join-Path $ur 'a1\in'; $outd = Join-Path $ur 'a1\out'
Remove-Item $in, $outd -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $in, $outd | Out-Null
foreach ($k in $Kinds) { Copy-Item (Join-Path $raw "$k.body.glb") (Join-Path $in "$k.glb") -Force }
if (-not $NoLock) {
  $got = $false; $t0 = Get-Date
  while (-not $got) {
    try { New-Item -ItemType Directory $lock -ErrorAction Stop | Out-Null; $got = $true } catch { if (((Get-Date) - $t0).TotalMinutes -gt 30) { throw 'gpu lock wait > 30 min' }; Start-Sleep 1 }
  }
  Set-Content (Join-Path $lock 'A1-unirig.txt') "A1-unirig $(Get-Date -Format o)"
}
try {
  Push-Location $ur
  $env:PYTHONIOENCODING = 'utf-8'
  $ErrorActionPreference = 'Continue'
  & $py -m src.data.extract --config=configs/data/quick_inference.yaml --require_suffix=glb --force_override=true --num_runs=1 --id=0 --time=a1 --faces_target_count=50000 --input_dir=a1/in --output_dir=tmp 2>&1 | Out-Null
  & $py run.py --task=configs/task/quick_inference_skeleton_articulationxl_ar_256.yaml --seed=12345 --input_dir=a1/in --output_dir=a1/out --npz_dir=tmp 2>&1 | Out-Null
  Pop-Location
} finally {
  if (-not $NoLock) {
    Remove-Item (Join-Path $lock 'A1-unirig.txt') -Force -ErrorAction SilentlyContinue
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
  }
}
foreach ($k in $Kinds) {
  $f = Get-ChildItem $outd -Recurse -Filter '*.fbx' | Where-Object { $_.FullName -match [regex]::Escape($k) } | Select-Object -First 1
  if ($f) { Copy-Item $f.FullName (Join-Path $raw "$k.skel.fbx") -Force; Write-Host "skeleton $k -> $($f.FullName)" } else { Write-Host "NO skeleton for $k" }
}
