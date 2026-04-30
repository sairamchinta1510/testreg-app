#!/usr/bin/env pwsh
# setup-monitoring.ps1 — Create log-based metrics and alert policies for testreg-gcp
# Usage: .\setup-monitoring.ps1 [-Project prj-d-srdl-casas-4zrs] [-AlertEmail you@example.com]

param(
  [string]$Project    = "prj-d-srdl-casas-4zrs",
  [string]$AlertEmail = "schinta@libertyglobal.com",
  [string]$Function   = "testreg-gcp"
)

$token   = (gcloud auth print-access-token 2>&1)
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }

# --- Log-based metrics ---

Write-Host "Creating log-based metrics..."

gcloud logging metrics create "$Function/error_count" `
  --description="Error count for $Function Cloud Function" `
  --log-filter="resource.type=`"cloud_run_revision`" resource.labels.service_name=`"$Function`" severity>=ERROR" `
  --project=$Project 2>&1 | Write-Host

gcloud logging metrics create "$Function/request_count" `
  --description="Total request count for $Function" `
  --log-filter="resource.type=`"cloud_run_revision`" resource.labels.service_name=`"$Function`" jsonPayload.message=`"Incoming request`"" `
  --project=$Project 2>&1 | Write-Host

$latencyMetric = @{
  name        = "$Function/latency"
  description = "Response latency for $Function (ms)"
  filter      = "resource.type=`"cloud_run_revision`" resource.labels.service_name=`"$Function`" jsonPayload.message=`"Outgoing response`""
  valueExtractor = "EXTRACT(jsonPayload.data.durationMs)"
  metricDescriptor = @{
    metricKind = "DELTA"; valueType = "DISTRIBUTION"; unit = "ms"
    labels = @(@{ key = "statusCode"; valueType = "INT64" })
  }
  labelExtractors = @{ statusCode = "EXTRACT(jsonPayload.data.statusCode)" }
  bucketOptions = @{ exponentialBuckets = @{ numFiniteBuckets = 10; growthFactor = 2; scale = 10 } }
} | ConvertTo-Json -Depth 10

$latencyMetric | Out-File -Encoding utf8 "$env:TEMP\latency_metric.json"
gcloud logging metrics create "$Function/latency" `
  --config-from-file="$env:TEMP\latency_metric.json" `
  --project=$Project 2>&1 | Write-Host

# --- Notification channel ---

Write-Host "Creating email notification channel -> $AlertEmail..."
$channelBody = @{
  type = "email"; displayName = "$Function alerts"
  labels = @{ email_address = $AlertEmail }
} | ConvertTo-Json

$channel = Invoke-RestMethod `
  -Uri "https://monitoring.googleapis.com/v3/projects/$Project/notificationChannels" `
  -Method POST -Headers $headers -Body $channelBody
$channelName = $channel.name
Write-Host "Channel: $channelName"

# --- Alert policies ---

Write-Host "Creating alert policies..."

$errorAlert = @{
  displayName = "${Function}: High Error Rate"
  combiner    = "OR"
  conditions  = @(@{
    displayName = "Error count > 5 in 5 min"
    conditionThreshold = @{
      filter = "resource.type=`"cloud_run_revision`" AND resource.labels.service_name=`"$Function`" AND metric.type=`"logging.googleapis.com/user/$Function/error_count`""
      aggregations = @(@{ alignmentPeriod = "300s"; perSeriesAligner = "ALIGN_SUM"; crossSeriesReducer = "REDUCE_SUM" })
      comparison = "COMPARISON_GT"; thresholdValue = 5; duration = "0s"
    }
  })
  notificationChannels = @($channelName)
  alertStrategy = @{ autoClose = "604800s" }
  documentation = @{ content = "${Function} errors > 5 in 5 min. Check Cloud Logging."; mimeType = "text/markdown" }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Uri "https://monitoring.googleapis.com/v3/projects/$Project/alertPolicies" `
  -Method POST -Headers $headers -Body $errorAlert | Select-Object name | Write-Host

$reqAlert = @{
  displayName = "${Function}: High Request Rate"
  combiner    = "OR"
  conditions  = @(@{
    displayName = "Requests > 100 per minute"
    conditionThreshold = @{
      filter = "resource.type=`"cloud_run_revision`" AND resource.labels.service_name=`"$Function`" AND metric.type=`"logging.googleapis.com/user/$Function/request_count`""
      aggregations = @(@{ alignmentPeriod = "60s"; perSeriesAligner = "ALIGN_SUM"; crossSeriesReducer = "REDUCE_SUM" })
      comparison = "COMPARISON_GT"; thresholdValue = 100; duration = "0s"
    }
  })
  notificationChannels = @($channelName)
  alertStrategy = @{ autoClose = "604800s" }
  documentation = @{ content = "${Function} receiving > 100 requests/min — possible traffic spike."; mimeType = "text/markdown" }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Uri "https://monitoring.googleapis.com/v3/projects/$Project/alertPolicies" `
  -Method POST -Headers $headers -Body $reqAlert | Select-Object name | Write-Host

Write-Host "Monitoring setup complete."
