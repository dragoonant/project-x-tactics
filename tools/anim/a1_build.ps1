# Joint table from the UniRig skeleton, then rig + bake + export, for each kind that has a skeleton and no up-to-date rigged GLB (CPU only).
# usage (from an interactive PowerShell): ./tools/anim/a1_build.ps1 [-Force] [-Preview] [kind ...]
param([switch]$Preview, [switch]$Force, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Kinds)
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$py = Join-Path $env:USERPROFILE 'Hunyuan3D-2.1\.venv\Scripts\python.exe'
$raw = Join-Path $repo 'art\rig\raw'
if (-not $Kinds) { $Kinds = (Get-Content (Join-Path $repo 'tools\anim\figures.json') | ConvertFrom-Json).figures.PSObject.Properties.Name }
foreach ($k in $Kinds) {
  $body = Join-Path $raw "$k.body.glb"; $skel = Join-Path $raw "$k.skel.fbx"; $rig = Join-Path $raw "$k.rigged.glb"
  if (-not (Test-Path $skel)) { continue }
  if (-not $Force -and (Test-Path $rig) -and ((Get-Item $rig).LastWriteTime -gt (Get-Item $skel).LastWriteTime) -and ((Get-Item $rig).LastWriteTime -gt (Get-Item (Join-Path $repo 'tools\anim\a1_catalog.py')).LastWriteTime)) { continue }
  Write-Host "== $k"
  & $py (Join-Path $repo 'tools\anim\a1_skel.py') $body $skel (Join-Path $raw "$k.joints.json") 2>&1 | Select-String 'MAP path|LOWER|rror|Traceback'
  $extra = @('--stretch'); if ($Preview) { $extra += '--preview' }
  & $py (Join-Path $repo 'tools\anim\a1_rig.py') $k @extra 2>&1 | Select-String 'SKIP|STRETCH|rror:|Traceback|TRIS|UNWEIGHTED|COAT|PLACEHOLDER|EXPORTED|HEAT|WELD|DISTANCE'
}
