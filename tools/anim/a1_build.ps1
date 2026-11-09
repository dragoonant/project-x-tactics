# Joint table from the UniRig skeleton, then rig + bake + export, for each kind given (CPU only).
# usage: powershell -File tools/anim/a1_build.ps1 [-Preview] recruit bulwark ...
param([switch]$Preview, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Kinds)
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$py = Join-Path $env:USERPROFILE 'Hunyuan3D-2.1\.venv\Scripts\python.exe'
$raw = Join-Path $repo 'art\rig\raw'
foreach ($k in $Kinds) {
  & $py (Join-Path $repo 'tools\anim\a1_skel.py') (Join-Path $raw "$k.body.glb") (Join-Path $raw "$k.skel.fbx") (Join-Path $raw "$k.joints.json") 2>&1 | Select-String 'MAP|LOWER|rror|Traceback'
  $extra = @('--stretch'); if ($Preview) { $extra += '--preview' }
  & $py (Join-Path $repo 'tools\anim\a1_rig.py') $k @extra 2>&1 | Select-String 'CLIP|STRETCH|SKIP|rror|Traceback|TRIS|UNWEIGHTED|COAT|EXPORTED'
}
