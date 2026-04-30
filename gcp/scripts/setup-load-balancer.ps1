#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploys testreg-gcp to two additional regions and creates a Global HTTPS
    Load Balancer in front of all three Cloud Function instances.

.DESCRIPTION
    Architecture after this script:

        Internet
           │
           ▼
    Global HTTPS Load Balancer  (api.gcp.testreg.tadpoleindustries.com)
           │
    ┌──────┼──────────────────────┐
    ▼      ▼                      ▼
  europe-west1   us-central1   europe-west2
  (existing)     (new)         (new)
  Cloud Function  Cloud Function  Cloud Function
  testreg-gcp    testreg-gcp    testreg-gcp

    Traffic is distributed across all three regions by GCP's global Anycast routing.

.PARAMETER Project
    GCP project ID. Default: prj-d-srdl-casas-4zrs

.PARAMETER Function
    Cloud Function name. Default: testreg-gcp

.PARAMETER PrimaryRegion
    Region where the function is already deployed. Default: europe-west1

.PARAMETER NewRegions
    Two additional regions to deploy to. Default: us-central1, europe-west2

.PARAMETER ApiDomain
    Custom domain for the load balancer. Default: api.gcp.testreg.tadpoleindustries.com

.PARAMETER KmsKey
    Full KMS key resource name (required by org CMEK policy).

.EXAMPLE
    .\setup-load-balancer.ps1
    .\setup-load-balancer.ps1 -Project my-project -ApiDomain api.example.com
#>

param(
    [string]$Project       = "prj-d-srdl-casas-4zrs",
    [string]$Function      = "testreg-gcp",
    [string]$PrimaryRegion = "europe-west1",
    [string[]]$NewRegions  = @("us-central1", "europe-west2"),
    [string]$ApiDomain     = "api.gcp.testreg.tadpoleindustries.com",
    [string]$KmsKey        = "projects/prj-d-srdl-casas-4zrs/locations/europe-west1/keyRings/casas-github/cryptoKeys/casas-repo-sync"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AllRegions = @($PrimaryRegion) + $NewRegions

function Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok([string]$msg)   { Write-Host "    ✓ $msg" -ForegroundColor Green }
function Warn([string]$msg) { Write-Host "    ⚠ $msg" -ForegroundColor Yellow }

# ── Prerequisites ──────────────────────────────────────────────────────────────
Step "Checking prerequisites"
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Error "gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install then re-run."
}
gcloud config set project $Project 2>&1 | Out-Null
Ok "gcloud authenticated, project = $Project"

# ── Enable required APIs ───────────────────────────────────────────────────────
Step "Enabling required GCP APIs"
$apis = @(
    "cloudfunctions.googleapis.com",
    "compute.googleapis.com",
    "certificatemanager.googleapis.com"
)
foreach ($api in $apis) {
    gcloud services enable $api --project=$Project 2>&1 | Out-Null
    Ok $api
}

# ── Deploy Cloud Function to new regions ───────────────────────────────────────
Step "Deploying $Function to additional regions: $($NewRegions -join ', ')"

# Determine the source directory (parent of scripts/)
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$SourceDir  = Split-Path -Parent $ScriptDir   # gcp/

foreach ($region in $NewRegions) {
    Write-Host "  Deploying to $region..." -NoNewline
    $result = gcloud functions deploy $Function `
        --gen2 `
        --runtime=nodejs20 `
        --region=$region `
        --source=$SourceDir `
        --entry-point=handler `
        --trigger-http `
        --allow-unauthenticated `
        --set-env-vars="GCP_PROJECT=$Project,GCP_KMS_KEY=$KmsKey" `
        --project=$Project 2>&1

    if ($LASTEXITCODE -ne 0) {
        Write-Host " FAILED" -ForegroundColor Red
        Write-Host $result
        Write-Error "Deployment to $region failed. Aborting."
    }
    Write-Host " done" -ForegroundColor Green
}
Ok "All regions deployed"

# ── Create Serverless NEGs ─────────────────────────────────────────────────────
Step "Creating Serverless Network Endpoint Groups (NEGs)"
foreach ($region in $AllRegions) {
    $negName = "$Function-neg-$region"
    $existing = gcloud compute network-endpoint-groups describe $negName `
        --region=$region --project=$Project 2>&1
    if ($LASTEXITCODE -eq 0) {
        Warn "NEG $negName already exists — skipping"
    } else {
        gcloud compute network-endpoint-groups create $negName `
            --region=$region `
            --network-endpoint-type=serverless `
            --cloud-function-name=$Function `
            --project=$Project 2>&1 | Out-Null
        Ok "Created NEG: $negName"
    }
}

# ── Backend service ────────────────────────────────────────────────────────────
Step "Creating backend service"
$backendName = "$Function-backend"
$existing = gcloud compute backend-services describe $backendName --global --project=$Project 2>&1
if ($LASTEXITCODE -eq 0) {
    Warn "Backend service $backendName already exists — skipping creation"
} else {
    gcloud compute backend-services create $backendName `
        --global `
        --project=$Project 2>&1 | Out-Null
    Ok "Created backend service: $backendName"
}

foreach ($region in $AllRegions) {
    $negName = "$Function-neg-$region"
    Write-Host "  Adding NEG $negName to backend..." -NoNewline
    gcloud compute backend-services add-backend $backendName `
        --global `
        --network-endpoint-group=$negName `
        --network-endpoint-group-region=$region `
        --project=$Project 2>&1 | Out-Null
    Write-Host " done" -ForegroundColor Green
}

# ── URL map ────────────────────────────────────────────────────────────────────
Step "Creating URL map"
$urlMapName = "$Function-url-map"
$existing = gcloud compute url-maps describe $urlMapName --project=$Project 2>&1
if ($LASTEXITCODE -eq 0) {
    Warn "URL map $urlMapName already exists — skipping"
} else {
    gcloud compute url-maps create $urlMapName `
        --default-service=$backendName `
        --project=$Project 2>&1 | Out-Null
    Ok "Created URL map: $urlMapName"
}

# ── Managed SSL certificate ────────────────────────────────────────────────────
Step "Creating Google-managed SSL certificate for $ApiDomain"
$certName = "$Function-cert"
$existing = gcloud compute ssl-certificates describe $certName --global --project=$Project 2>&1
if ($LASTEXITCODE -eq 0) {
    Warn "SSL certificate $certName already exists — skipping"
} else {
    gcloud compute ssl-certificates create $certName `
        --domains=$ApiDomain `
        --global `
        --project=$Project 2>&1 | Out-Null
    Ok "Created SSL certificate: $certName (provisioning may take 10-30 min after DNS is set)"
}

# ── HTTPS target proxy ─────────────────────────────────────────────────────────
Step "Creating HTTPS target proxy"
$proxyName = "$Function-https-proxy"
$existing = gcloud compute target-https-proxies describe $proxyName --project=$Project 2>&1
if ($LASTEXITCODE -eq 0) {
    Warn "HTTPS proxy $proxyName already exists — skipping"
} else {
    gcloud compute target-https-proxies create $proxyName `
        --ssl-certificates=$certName `
        --url-map=$urlMapName `
        --project=$Project 2>&1 | Out-Null
    Ok "Created HTTPS proxy: $proxyName"
}

# ── Global static IP ───────────────────────────────────────────────────────────
Step "Reserving global static IP"
$ipName = "$Function-ip"
$existing = gcloud compute addresses describe $ipName --global --project=$Project 2>&1
if ($LASTEXITCODE -eq 0) {
    Warn "IP address $ipName already exists — skipping reservation"
} else {
    gcloud compute addresses create $ipName `
        --global `
        --project=$Project 2>&1 | Out-Null
    Ok "Reserved global IP: $ipName"
}
$lbIp = gcloud compute addresses describe $ipName --global `
    --format="value(address)" --project=$Project 2>&1
Ok "Load Balancer IP: $lbIp"

# ── HTTPS forwarding rule ──────────────────────────────────────────────────────
Step "Creating HTTPS forwarding rule"
$ruleName = "$Function-https-rule"
$existing = gcloud compute forwarding-rules describe $ruleName --global --project=$Project 2>&1
if ($LASTEXITCODE -eq 0) {
    Warn "Forwarding rule $ruleName already exists — skipping"
} else {
    gcloud compute forwarding-rules create $ruleName `
        --global `
        --target-https-proxy=$proxyName `
        --address=$ipName `
        --ports=443 `
        --project=$Project 2>&1 | Out-Null
    Ok "Created forwarding rule: $ruleName"
}

# ── HTTP→HTTPS redirect (port 80) ─────────────────────────────────────────────
Step "Creating HTTP → HTTPS redirect"
$redirectMapName = "$Function-http-redirect"
$httpProxyName   = "$Function-http-proxy"
$httpRuleName    = "$Function-http-rule"

$existing = gcloud compute url-maps describe $redirectMapName --project=$Project 2>&1
if ($LASTEXITCODE -ne 0) {
    gcloud compute url-maps import $redirectMapName `
        --global --project=$Project `
        --source /dev/stdin <<'YAML' 2>&1 | Out-Null
name: placeholder
defaultUrlRedirect:
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
  httpsRedirect: true
YAML
    # Fallback: create via gcloud for Windows (no heredoc)
    $redirectYaml = @"
name: $redirectMapName
defaultUrlRedirect:
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
  httpsRedirect: true
"@
    $tmpFile = "$env:TEMP\redirect-map.yaml"
    $redirectYaml | Out-File -Encoding utf8 $tmpFile
    gcloud compute url-maps import $redirectMapName `
        --global --project=$Project `
        --source $tmpFile 2>&1 | Out-Null
    Remove-Item $tmpFile -ErrorAction SilentlyContinue
    Ok "Created HTTP redirect URL map"
}

$existing = gcloud compute target-http-proxies describe $httpProxyName --project=$Project 2>&1
if ($LASTEXITCODE -ne 0) {
    gcloud compute target-http-proxies create $httpProxyName `
        --url-map=$redirectMapName `
        --project=$Project 2>&1 | Out-Null
    Ok "Created HTTP proxy: $httpProxyName"
}

$existing = gcloud compute forwarding-rules describe $httpRuleName --global --project=$Project 2>&1
if ($LASTEXITCODE -ne 0) {
    gcloud compute forwarding-rules create $httpRuleName `
        --global `
        --target-http-proxy=$httpProxyName `
        --address=$ipName `
        --ports=80 `
        --project=$Project 2>&1 | Out-Null
    Ok "Created HTTP→HTTPS forwarding rule"
}

# ── Summary ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host " Load Balancer setup complete!" -ForegroundColor Green
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Load Balancer IP : $lbIp"
Write-Host "  API domain       : https://$ApiDomain"
Write-Host "  Backend regions  : $($AllRegions -join ' | ')"
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "  1. In Route 53, create an A record:"
Write-Host "       $ApiDomain  →  $lbIp"
Write-Host "  2. Wait 10-30 min for Google-managed SSL cert to provision"
Write-Host "  3. The frontend HTML files have already been updated to use"
Write-Host "       https://$ApiDomain"
Write-Host ""
Write-Host "  Verify LB health:"
Write-Host "    gcloud compute backend-services get-health $backendName --global --project=$Project"
Write-Host ""
