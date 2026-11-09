# Optimise the staged GLBs (art/rig/scratch/*.glb and items/*.glb) into public/assets/anim: meshopt + WebP 1024.
# Run from a scratch folder outside the repo tree's package context (gltf-transform needs no project): this script cd's to the scratch dir.
# usage: powershell -File tools/anim/optimise.ps1 [kind|item ...]   (default: everything staged)
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scr = Join-Path $repo 'art\rig\scratch'
$out = Join-Path $repo 'public\assets\anim'
New-Item -ItemType Directory -Force (Join-Path $out 'items') | Out-Null
Push-Location $scr
$files = @(Get-ChildItem $scr -Filter *.glb) + @(Get-ChildItem (Join-Path $scr 'items') -Filter *.glb)
foreach ($f in $files) {
  $rel = if ($f.DirectoryName -like '*items') { "items\$($f.Name)" } else { $f.Name }
  $name = [IO.Path]::GetFileNameWithoutExtension($f.Name)
  if ($args.Count -gt 0 -and ($args -notcontains $name)) { continue }
  npx --no-install @gltf-transform/cli optimize $f.FullName (Join-Path $out $rel) --compress meshopt --texture-compress webp --texture-size 1024 2>&1 | Select-Object -Last 2
  Write-Host $rel ((Get-Item (Join-Path $out $rel)).Length / 1MB)
}
Pop-Location
