# Test 12c -- Flux complet 2FA (login -> OTP -> JWT)
# Usage : powershell -ExecutionPolicy Bypass -File test-12c.ps1

$ErrorActionPreference = 'SilentlyContinue'
$apiDir  = Split-Path $MyInvocation.MyCommand.Path -Resolve
$logFile = "$env:TEMP\api-12c.log"

if (Test-Path $logFile) { Remove-Item $logFile }
New-Item -ItemType File -Path $logFile -Force | Out-Null

Write-Host ""
Write-Host "=== Demarrage du serveur API (port 3000) ===" -ForegroundColor Cyan
$proc = Start-Process `
    -FilePath "node" `
    -ArgumentList "--no-warnings", "server.js" `
    -WorkingDirectory $apiDir `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput $logFile
Start-Sleep -Seconds 2

# ------------------------------------------------------------------
# Helper HTTP via curl.exe (fourni nativement Windows 10/11)
# Retourne @{ status=<int>; body=<PSCustomObject> }
# Fonctionne aussi bien sur les 4xx/5xx que les 2xx
# ------------------------------------------------------------------
function Invoke-API {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Body  = $null,
        [string]$Token    = $null
    )
    $uri  = "http://localhost:3000$Path"
    $argv = @('-s', '-w', "`n%{http_code}", '-X', $Method.ToUpper(), $uri,
              '-H', 'Content-Type: application/json')
    if ($Token) { $argv += @('-H', "Authorization: Bearer $Token") }

    # Ecrire le body JSON dans un fichier temporaire pour eviter les problemes
    # de guillemets que PowerShell 5.1 introduit en passant des args a curl.exe
    $tmpBody = $null
    if ($Body) {
        $tmpBody = Join-Path $env:TEMP "api-test-body.json"
        $jsonStr = $Body | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($tmpBody, $jsonStr, [Text.Encoding]::UTF8)
        $argv += @('-d', "@$tmpBody")
    }

    $raw = (& curl.exe @argv 2>&1) -join "`n"
    if ($tmpBody -and (Test-Path $tmpBody)) { Remove-Item $tmpBody -ErrorAction SilentlyContinue }

    $lastNl = $raw.LastIndexOf("`n")
    if ($lastNl -lt 0) {
        return @{ status = ([int]$raw.Trim()); body = [pscustomobject]@{} }
    }

    $code     = [int]$raw.Substring($lastNl + 1).Trim()
    $bodyText = $raw.Substring(0, $lastNl).Trim()

    $parsed = $null
    if ($bodyText) {
        try   { $parsed = $bodyText | ConvertFrom-Json }
        catch { $parsed = [pscustomobject]@{ raw = $bodyText } }
    }
    if (-not $parsed) { $parsed = [pscustomobject]@{} }

    return @{ status = $code; body = $parsed }
}

function Get-LatestOTP {
    param([string]$LogPath)
    $c = Get-Content $LogPath -Raw -ErrorAction SilentlyContinue
    if (-not $c) { return $null }
    $m = [regex]::Matches($c, '\[OTP\].*?: (\d{6})')
    if ($m.Count -eq 0) { return $null }
    return $m[$m.Count - 1].Groups[1].Value
}

$pass = 0; $fail = 0
function Assert {
    param([string]$Label, [bool]$Cond)
    if ($Cond) {
        Write-Host "  OK   $Label" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "  FAIL $Label" -ForegroundColor Red
        $script:fail++
    }
}

# ==================================================================
Write-Host ""
Write-Host "-- 1. Login identifiants invalides --" -ForegroundColor Yellow

$r = Invoke-API -Method POST -Path /auth/login -Body @{ email='admin@datacenter.local'; mot_de_passe='wrong' }
Assert "Mauvais mdp -> 401"     ($r.status -eq 401)

$r = Invoke-API -Method POST -Path /auth/login -Body @{ email='inconnu@x.com'; mot_de_passe='Admin1234!' }
Assert "Email inconnu -> 401"   ($r.status -eq 401)

$r = Invoke-API -Method POST -Path /auth/login -Body @{ email='admin@datacenter.local' }
Assert "Champ manquant -> 400"  ($r.status -eq 400)

# ==================================================================
Write-Host ""
Write-Host "-- 2. Login valide -> login_token --" -ForegroundColor Yellow

$r = Invoke-API -Method POST -Path /auth/login -Body @{ email='admin@datacenter.local'; mot_de_passe='Admin1234!' }
Assert "Login valide -> 200"          ($r.status -eq 200)
Assert "etape = otp_requis"           ($r.body.etape -eq 'otp_requis')
Assert "login_token present"          ($null -ne $r.body.login_token)
$loginToken = $r.body.login_token
Write-Host "     login_token: $($loginToken.Substring(0, [Math]::Min(50,$loginToken.Length)))..." -ForegroundColor DarkGray

Start-Sleep -Milliseconds 400
$otp = Get-LatestOTP $logFile
Assert "OTP 6 chiffres dans les logs"  ($otp -match '^\d{6}$')
Write-Host "     OTP recupere : $otp" -ForegroundColor Cyan

# ==================================================================
Write-Host ""
Write-Host "-- 3. verify-otp : mauvais code --" -ForegroundColor Yellow

$wrong = if ($otp -ne '000000') { '000000' } else { '111111' }
$r = Invoke-API -Method POST -Path /auth/verify-otp -Body @{ login_token=$loginToken; code=$wrong }
Assert "Mauvais code -> 401"             ($r.status -eq 401)
Assert "Message contient 'tentative'"   ($r.body.erreur -like '*tentative*')
Write-Host "     $($r.body.erreur)" -ForegroundColor DarkGray

# ==================================================================
Write-Host ""
Write-Host "-- 4. verify-otp : code correct -> JWT --" -ForegroundColor Yellow

$r = Invoke-API -Method POST -Path /auth/verify-otp -Body @{ login_token=$loginToken; code=$otp }
Assert "Code correct -> 200"        ($r.status -eq 200)
Assert "token present"              ($null -ne $r.body.token)
Assert "role = administrateur"      ($r.body.role -eq 'administrateur')
Assert "email correct"              ($r.body.email -eq 'admin@datacenter.local')
$jwt = $r.body.token
Write-Host "     JWT: $($jwt.Substring(0, [Math]::Min(50,$jwt.Length)))..." -ForegroundColor DarkGray

# ==================================================================
Write-Host ""
Write-Host "-- 5. Replay du meme OTP (deja consomme) --" -ForegroundColor Yellow

$r = Invoke-API -Method POST -Path /auth/verify-otp -Body @{ login_token=$loginToken; code=$otp }
Assert "OTP consomme -> 401"  ($r.status -eq 401)
Write-Host "     $($r.body.erreur)" -ForegroundColor DarkGray

# ==================================================================
Write-Host ""
Write-Host "-- 6. GET /auth/me --" -ForegroundColor Yellow

$r = Invoke-API -Method GET -Path /auth/me -Token $jwt
Assert "GET /auth/me -> 200"              ($r.status -eq 200)
Assert "email correct"                    ($r.body.email -eq 'admin@datacenter.local')
Assert "role administrateur"             ($r.body.role -eq 'administrateur')
Assert "derniere_connexion renseignee"   ($null -ne $r.body.derniere_connexion)

$r = Invoke-API -Method GET -Path /auth/me
Assert "Sans token -> 401"               ($r.status -eq 401)

$r = Invoke-API -Method GET -Path /auth/me -Token $loginToken
Assert "login_token refuse sur /me -> 401"  ($r.status -eq 401)
Write-Host "     $($r.body.erreur)" -ForegroundColor DarkGray

# ==================================================================
Write-Host ""
Write-Host "-- 7. OTP expire --" -ForegroundColor Yellow

$r2  = Invoke-API -Method POST -Path /auth/login -Body @{ email='admin@datacenter.local'; mot_de_passe='Admin1234!' }
$lt2 = $r2.body.login_token
Start-Sleep -Milliseconds 400
$otp2 = Get-LatestOTP $logFile

# Expirer l'OTP via un fichier JS temporaire (evite les problemes de guillemets inline)
$tmpJs = Join-Path $apiDir "_tmp_expire.js"
$jsContent = @'
const db = require('./db/database');
db.prepare(
  "UPDATE codes_otp SET expire_le = datetime('now', '-1 minute') " +
  "WHERE utilise = 0 AND id = (SELECT MAX(id) FROM codes_otp WHERE utilise = 0)"
).run();
process.stdout.write('ok');
'@
[IO.File]::WriteAllText($tmpJs, $jsContent, [Text.Encoding]::UTF8)
$expireOut = (& node --no-warnings $tmpJs 2>&1) -join ''
Remove-Item $tmpJs -ErrorAction SilentlyContinue

if ($expireOut -eq 'ok') {
    $r = Invoke-API -Method POST -Path /auth/verify-otp -Body @{ login_token=$lt2; code=$otp2 }
    Assert "OTP expire -> 401"           ($r.status -eq 401)
    Assert "Message contient 'expir'"    ($r.body.erreur -like '*expir*')
    Write-Host "     $($r.body.erreur)" -ForegroundColor DarkGray
} else {
    Write-Host "  [SKIP] Expiration DB echouee - sortie node : $expireOut" -ForegroundColor DarkYellow
}

# ==================================================================
Write-Host ""
Write-Host "-- 8. Epuisement des tentatives (3 mauvais codes) --" -ForegroundColor Yellow

$r3    = Invoke-API -Method POST -Path /auth/login -Body @{ email='admin@datacenter.local'; mot_de_passe='Admin1234!' }
$lt3   = $r3.body.login_token
Start-Sleep -Milliseconds 400
$otp3  = Get-LatestOTP $logFile
$w3    = if ($otp3 -ne '000000') { '000000' } else { '111111' }

$r = Invoke-API -Method POST -Path /auth/verify-otp -Body @{ login_token=$lt3; code=$w3 }
Assert "Tentative 1/3 -> 401 + 2 restantes" ($r.status -eq 401 -and $r.body.erreur -like '*2 tentative*')
Write-Host "     $($r.body.erreur)" -ForegroundColor DarkGray

$r = Invoke-API -Method POST -Path /auth/verify-otp -Body @{ login_token=$lt3; code=$w3 }
Assert "Tentative 2/3 -> 401 + 1 restante"  ($r.status -eq 401 -and $r.body.erreur -like '*1 tentative*')
Write-Host "     $($r.body.erreur)" -ForegroundColor DarkGray

$r = Invoke-API -Method POST -Path /auth/verify-otp -Body @{ login_token=$lt3; code=$w3 }
Assert "Tentative 3/3 -> 429 epuise"         ($r.status -eq 429)
Write-Host "     $($r.body.erreur)" -ForegroundColor DarkGray

# Apres epuisement, le bon code doit etre refuse (OTP invalide -> 401 ou 429)
$r = Invoke-API -Method POST -Path /auth/verify-otp -Body @{ login_token=$lt3; code=$otp3 }
Assert "Bon code refuse apres epuisement"    ($r.status -eq 401 -or $r.status -eq 429)
Write-Host "     $($r.body.erreur)" -ForegroundColor DarkGray

# ==================================================================
Write-Host ""
Write-Host "-- 9. POST /auth/logout --" -ForegroundColor Yellow

$r = Invoke-API -Method POST -Path /auth/logout -Token $jwt
Assert "Logout -> 200"             ($r.status -eq 200)

$r = Invoke-API -Method POST -Path /auth/logout
Assert "Logout sans token -> 401"  ($r.status -eq 401)

# ==================================================================
Write-Host ""
Write-Host "-- 10. Resend-OTP anti-abus (< 60s) --" -ForegroundColor Yellow

$r4  = Invoke-API -Method POST -Path /auth/login -Body @{ email='admin@datacenter.local'; mot_de_passe='Admin1234!' }
$lt4 = $r4.body.login_token

$r = Invoke-API -Method POST -Path /auth/resend-otp -Body @{ login_token=$lt4 }
Assert "Resend immediat -> 429"         ($r.status -eq 429)
Assert "Message contient 'Attendez'"   ($r.body.erreur -like '*ttendez*')
Write-Host "     $($r.body.erreur)" -ForegroundColor DarkGray

# ==================================================================
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
$color = if ($fail -eq 0) { 'Green' } else { 'Red' }
Write-Host "  Resultat : $pass OK  |  $fail FAIL" -ForegroundColor $color
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$proc.Kill()
Write-Host "Serveur arrete (PID $($proc.Id))" -ForegroundColor DarkGray
Write-Host ""
exit $(if ($fail -gt 0) { 1 } else { 0 })
