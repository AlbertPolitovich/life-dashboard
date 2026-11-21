# Общие SSH-опции для deploy-скриптов. Подключать после VPS_USER / VPS_HOST.
# Пароль спросят один раз; дальше rsync/scp/ssh идут через одно соединение (ControlMaster).

life_dashboard_ssh_init() {
  # Короткий путь: macOS /var/folders/... + длинный %h даёт socket path > 104 байт.
  mkdir -p "${HOME}/.ssh"
  chmod 700 "${HOME}/.ssh"
  SSH_CONTROL_PATH="${HOME}/.ssh/ld-%C"
  export SSH_CONTROL_PATH
  RSYNC_RSH="ssh -o ConnectTimeout=15 -o ControlMaster=auto -o ControlPath=${SSH_CONTROL_PATH} -o ControlPersist=300"
  export RSYNC_RSH
}

life_dashboard_ssh() {
  ssh -o ConnectTimeout=15 -o ControlMaster=auto -o "ControlPath=${SSH_CONTROL_PATH}" -o ControlPersist=300 "$@"
}

life_dashboard_scp() {
  scp -o ConnectTimeout=15 -o ControlMaster=auto -o "ControlPath=${SSH_CONTROL_PATH}" -o ControlPersist=300 "$@"
}

life_dashboard_ssh_close() {
  ssh -o "ControlPath=${SSH_CONTROL_PATH}" -O exit "${VPS_USER}@${VPS_HOST}" 2>/dev/null || true
}
