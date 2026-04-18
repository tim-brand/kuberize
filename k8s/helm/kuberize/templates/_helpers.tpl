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

{{- define "kuberize.apiKey" -}}
{{- if .Values.apiKey -}}
{{ .Values.apiKey }}
{{- else -}}
{{ randAlphaNum 32 }}
{{- end -}}
{{- end -}}

{{- define "kuberize.githubWebhookSecret" -}}
{{- if .Values.githubWebhookSecret -}}
{{ .Values.githubWebhookSecret }}
{{- else -}}
{{ randAlphaNum 32 }}
{{- end -}}
{{- end -}}
