# Deploys the latest code on the server PC (pivot.md §12.5). Run it from the
# project folder, in a PowerShell opened as Administrator (restarting the
# service needs it):
#
#   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
#
# The frontend is built here, at every deploy, so the build reads this
# install's environment. Only VITE_-prefixed variables ever reach the
# browser, and anyone using the app can read those: never put secrets in
# them. Secrets stay in .env, read by the server only.
#
# If npm reports install scripts that need approval, approve the ones this
# app needs once, then deploy again:
#   npm install-scripts approve argon2 prisma @prisma/client @prisma/engines

$ErrorActionPreference = "Stop"
$ServiceName = "LabManagementSystem" # the NSSM service's name; change it to match yours

Set-Location (Split-Path $PSScriptRoot -Parent)

function Step($Name, $Command) {
  Write-Host "==> $Name"
  cmd /c $Command
  if ($LASTEXITCODE -ne 0) { throw "$Name failed." }
}

Step "Fetching the latest code" "git pull --ff-only"
Step "Installing dependencies, including the build tools" "npm ci --include=dev"
Step "Generating the database client" "npx prisma generate"
Step "Applying database migrations" "npx prisma migrate deploy"
Step "Building the frontend" "npm run build"
Step "Restarting the $ServiceName service" "nssm restart $ServiceName"

Write-Host "Deployed."
