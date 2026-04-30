#!/usr/bin/env pwsh
# seed-bigquery.ps1 — Bulk-insert random registrations into BigQuery
# Usage: .\seed-bigquery.ps1 [-Count 1000] [-Project prj-d-srdl-casas-4zrs]

param(
  [int]   $Count   = 1000,
  [string]$Project = "prj-d-srdl-casas-4zrs",
  [string]$Dataset = "testreg",
  [string]$Table   = "registrations",
  [string]$KmsKey  = "projects/prj-d-srdl-casas-4zrs/locations/europe-west1/keyRings/casas-github/cryptoKeys/casas-repo-sync"
)

$firstNames = @("James","Oliver","Harry","Jack","George","Noah","Charlie","Jacob","Alfie","Freddie","Isla","Olivia","Amelia","Emily","Ava","Jessica","Lily","Sophie","Grace","Mia","Liam","Ethan","Mason","Lucas","Logan","Aiden","Elijah","William","Muhammad","Leo","Ella","Chloe","Isabella","Scarlett","Charlotte","Daisy","Evie","Poppy","Ruby","Millie","Dylan","Ryan","Connor","Thomas","Daniel","Alex","Sam","Jordan","Taylor","Morgan")
$lastNames  = @("Smith","Jones","Williams","Taylor","Brown","Davies","Evans","Wilson","Thomas","Roberts","Johnson","Lewis","Walker","Robinson","White","Thompson","Martin","Clarke","Hall","Jackson","Wood","Turner","Bell","Collins","Edwards","Green","Harris","Hughes","Moore","Morris","Hill","Cooper","Barnes","Mitchell","Ward","Murray","Carter","Baker","Adams","Phillips","Campbell","Parker","Rogers","Stewart","Reed","Cook","Bennett","Gray","Ross","Price")
$streets    = @("High Street","Church Lane","Station Road","Mill Lane","Victoria Road","Green Lane","London Road","Manor Road","Kings Road","The Avenue","Park Road","Oak Street","Elm Avenue","Cedar Close","Maple Drive","Rose Lane","Birch Way","Willow Court","Poplar Road","Ash Grove","Queen Street","Castle Road","Bridge Street","North Lane","South Avenue","West Close","East Drive","Hill Road","River Lane","Market Street")
$cities     = @("London","Manchester","Birmingham","Leeds","Liverpool","Sheffield","Bristol","Glasgow","Edinburgh","Cardiff","Newcastle","Nottingham","Leicester","Coventry","Bradford","Belfast","Stoke","Wolverhampton","Derby","Portsmouth","Southampton","Reading","Oxford","Cambridge","York","Exeter","Norwich","Plymouth","Brighton","Bath")
$postcodes  = @("SW1A 1AA","M1 1AD","B1 1BB","LS1 1BA","L1 1EH","S1 2HH","BS1 1AA","G1 1AR","EH1 1AA","CF10 1ET","NE1 1EE","NG1 1AA","LE1 1AA","CV1 1AA","BD1 1AA","BT1 1AA","ST1 1AA","WV1 1AA","DE1 1AA","PO1 1AA","SO14 1AA","RG1 1AA","OX1 1AA","CB1 1AA","YO1 1AA","EX1 1AA","NR1 1AA","PL1 1AA","BN1 1AA","BA1 1AA")

Write-Host "Generating $Count random records..."

$rows = New-Object System.Collections.Generic.List[string]
$base = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())

for ($i = 0; $i -lt $Count; $i++) {
  $id   = $base + $i
  $fn   = $firstNames[(Get-Random -Maximum $firstNames.Count)]
  $ln   = $lastNames[(Get-Random  -Maximum $lastNames.Count)]
  $num  = Get-Random -Minimum 1 -Maximum 999
  $st   = $streets[(Get-Random   -Maximum $streets.Count)]
  $city = $cities[(Get-Random    -Maximum $cities.Count)]
  $pc   = $postcodes[(Get-Random -Maximum $postcodes.Count)]
  $year = Get-Random -Minimum 1950 -Maximum 2005
  $mon  = "{0:D2}" -f (Get-Random -Minimum 1  -Maximum 12)
  $day  = "{0:D2}" -f (Get-Random -Minimum 1  -Maximum 28)
  $hh   = "{0:D2}" -f (Get-Random -Minimum 0  -Maximum 23)
  $mm   = "{0:D2}" -f (Get-Random -Minimum 0  -Maximum 59)
  $ss   = "{0:D2}" -f (Get-Random -Minimum 0  -Maximum 59)
  $s1   = "{0:D3}" -f (Get-Random -Minimum 100 -Maximum 999)
  $s2   = "{0:D2}" -f (Get-Random -Minimum 10  -Maximum 99)
  $s3   = "{0:D4}" -f (Get-Random -Minimum 1000 -Maximum 9999)
  $sfx  = Get-Random -Minimum 1 -Maximum 9999

  $row = [ordered]@{
    id           = "$id"
    firstName    = $fn
    lastName     = $ln
    email        = "$($fn.ToLower()).$($ln.ToLower())$sfx@example.com"
    phone        = "077$(Get-Random -Minimum 10000000 -Maximum 99999999)"
    address      = "$num $st"
    city         = $city
    postcode     = $pc
    country      = "UK"
    dob          = "$year-$mon-$day"
    ssn          = "$s1-$s2-$s3"
    registeredAt = "2026-04-30 ${hh}:${mm}:${ss} UTC"
    updatedAt    = $null
  }
  $rows.Add(($row | ConvertTo-Json -Compress))
}

$tmpFile = "$env:TEMP\bq_seed_$Count.ndjson"
$rows | Set-Content -Encoding utf8 $tmpFile
Write-Host "Written to $tmpFile — loading into BigQuery..."

bq load `
  --source_format=NEWLINE_DELIMITED_JSON `
  --destination_kms_key=$KmsKey `
  --project_id=$Project `
  "${Project}:${Dataset}.${Table}" `
  $tmpFile

if ($LASTEXITCODE -eq 0) {
  Write-Host "Done. Verifying row count..."
  bq query --use_legacy_sql=false --project_id=$Project --destination_kms_key=$KmsKey `
    "SELECT COUNT(*) as total FROM ``${Project}.${Dataset}.${Table}``"
} else {
  Write-Host "bq load failed — check output above."
}
