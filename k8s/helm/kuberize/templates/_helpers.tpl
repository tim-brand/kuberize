{{/*
Common labels applied to all resources
*/}}
{{- define "kuberize.labels" -}}
app.kubernetes.io/name: kuberize
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/*
Generated secrets must survive upgrades: re-randomizing on every render would
rotate GITHUB_WEBHOOK_SECRET out from under registered GitHub webhooks (401
invalid signature) and invalidate issued API keys. When no explicit value is
set, reuse the value from the existing Secret via lookup; only generate a
fresh random on first install (lookup is empty during template/install render).
*/}}
{{- define "kuberize.apiKey" -}}
{{- if .Values.apiKey -}}
{{ .Values.apiKey }}
{{- else -}}
{{- $data := (lookup "v1" "Secret" "kuberize-system" "kuberize-api-secrets").data | default dict -}}
{{- if hasKey $data "API_KEY" -}}
{{ index $data "API_KEY" | b64dec }}
{{- else -}}
{{ randAlphaNum 32 }}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "kuberize.githubWebhookSecret" -}}
{{- if .Values.githubWebhookSecret -}}
{{ .Values.githubWebhookSecret }}
{{- else -}}
{{- $data := (lookup "v1" "Secret" "kuberize-system" "kuberize-api-secrets").data | default dict -}}
{{- if hasKey $data "GITHUB_WEBHOOK_SECRET" -}}
{{ index $data "GITHUB_WEBHOOK_SECRET" | b64dec }}
{{- else -}}
{{ randAlphaNum 32 }}
{{- end -}}
{{- end -}}
{{- end -}}
