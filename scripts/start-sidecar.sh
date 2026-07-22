#!/usr/bin/env bash
# ---------------------------------------------------------
# start-sidecar.sh — Start the pi-sidecar HTTP server for
# local development and testing.
#
# Usage:
#   scripts/start-sidecar.sh              # background (default)
#   scripts/start-sidecar.sh --foreground # foreground (Ctrl-C to stop)
#   scripts/start-sidecar.sh --stop       # kill a running sidecar
#   scripts/start-sidecar.sh --help       # show usage
#
# Environment:
#   SIDECAR_PORT  — listen port  (default: 9201)
#   SIDECAR_HOST  — bind address (default: 127.0.0.1)
# ---------------------------------------------------------
set -euo pipefail

readonly PORT="${SIDECAR_PORT:-9201}"
readonly HOST="${SIDECAR_HOST:-127.0.0.1}"
readonly LOG_DIR="/tmp/pi-work/pi-sidecar"
readonly LOG_FILE="${LOG_DIR}/sidecar.log"
# Bind host may be a wildcard (0.0.0.0 / ::); health probes need a connectable loopback.
case "${HOST}" in
    0.0.0.0) readonly HEALTH_HOST="127.0.0.1" ;;
    ::)      readonly HEALTH_HOST="::1" ;;
    *)       readonly HEALTH_HOST="${HOST}" ;;
esac
readonly HEALTH_URL="http://${HEALTH_HOST}:${PORT}/health"
readonly HEALTH_TIMEOUT=60

# ── Helpers ──────────────────────────────────────────────

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Start or stop the pi-sidecar HTTP server.

Options:
  --foreground   Run in the foreground (default: background)
  --stop         Stop a running sidecar on the configured port
  -h, --help     Show this help message

Environment variables:
  SIDECAR_PORT   Listen port   (default: 9201)
  SIDECAR_HOST   Bind address  (default: 127.0.0.1)

Log file: ${LOG_DIR}/sidecar.log
EOF
}

die() { echo "ERROR: $*" >&2; exit 1; }

# Return the first PID listening on the configured port, or empty string.
pid_on_port() {
    # Try lsof first (macOS, full Linux), fall back to fuser (minimal containers)
    if command -v lsof >/dev/null 2>&1; then
        lsof -ti "tcp:${PORT}" -s "tcp:listen" 2>/dev/null | head -1 || true
    elif command -v fuser >/dev/null 2>&1; then
        fuser "${PORT}/tcp" 2>/dev/null | tr -s ' ' '\n' | grep -v '^$' | head -1 || true
    else
        echo ""
    fi
}

wait_for_health() {
    local elapsed=0
    echo "Waiting for sidecar health check (up to ${HEALTH_TIMEOUT}s)…"
    while (( elapsed < HEALTH_TIMEOUT )); do
        if curl -sf "${HEALTH_URL}" >/dev/null 2>&1; then
            echo "Health check passed after ${elapsed}s."
            return 0
        fi
        sleep 1
        (( elapsed++ )) || true
    done
    die "Sidecar did not become healthy within ${HEALTH_TIMEOUT}s. Check ${LOG_FILE}"
}

# ── Commands ─────────────────────────────────────────────

stop_sidecar() {
    local pid
    pid="$(pid_on_port | tr -d '[:space:]')"
    if [[ -z "${pid}" ]]; then
        echo "No sidecar running on port ${PORT}."
        return 0
    fi
    echo "Stopping sidecar (PID ${pid}) on port ${PORT}…"
    kill "${pid}"
    # Wait up to 5 seconds for a clean exit.
    local i=0
    while (( i < 50 )); do
        if ! kill -0 "${pid}" 2>/dev/null; then
            echo "Sidecar stopped."
            return 0
        fi
        sleep 0.1
        (( i++ )) || true
    done
    echo "Sending SIGKILL…"
    kill -9 "${pid}" 2>/dev/null || true
    echo "Sidecar killed."
}

ensure_log_dir() {
    mkdir -p -m 700 "${LOG_DIR}"
    # Refuse to write if another user owns the path (symlink / sticky /tmp races).
    if [[ ! -O "${LOG_DIR}" ]]; then
        die "Log directory ${LOG_DIR} is not owned by the current user"
    fi
    chmod 700 "${LOG_DIR}" 2>/dev/null || true
}

start_foreground() {
    echo "Starting sidecar in foreground on ${HOST}:${PORT}"
    echo "Log: ${LOG_FILE}"
    ensure_log_dir
    exec env SIDECAR_PORT="${PORT}" SIDECAR_HOST="${HOST}" \
        npx tsx src/server.ts 2>&1 | tee -a "${LOG_FILE}"
}

start_background() {
    ensure_log_dir
    nohup env SIDECAR_PORT="${PORT}" SIDECAR_HOST="${HOST}" \
        npx tsx src/server.ts >> "${LOG_FILE}" 2>&1 &
    local pid=$!
    disown "${pid}" 2>/dev/null || disown || true

    # If health never becomes OK, die() would leave this nohup process orphaned.
    # Kill it on any non-zero exit during the startup wait, then clear the trap.
    cleanup_startup() {
        local ec=$?
        if [[ "${ec}" -ne 0 ]] && kill -0 "${pid}" 2>/dev/null; then
            echo "Startup failed (exit=${ec}); killing sidecar PID ${pid}…" >&2
            echo "──── last 40 log lines ────" >&2
            tail -n 40 "${LOG_FILE}" 2>/dev/null >&2 || true
            echo "───────────────────────────" >&2
            kill "${pid}" 2>/dev/null || true
            sleep 1
            kill -9 "${pid}" 2>/dev/null || true
        fi
    }
    trap cleanup_startup EXIT

    wait_for_health
    trap - EXIT

    echo "──────────────────────────────────────"
    echo "pi-sidecar running"
    echo "  URL : http://${HOST}:${PORT}"
    echo "  PID : ${pid}"
    echo "  Log : ${LOG_FILE}"
    echo "──────────────────────────────────────"
}

# ── Main ─────────────────────────────────────────────────

main() {
    local foreground=false
    local stop=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --foreground) foreground=true ;;
            --stop)       stop=true ;;
            -h|--help)    usage; exit 0 ;;
            *)            die "Unknown option: $1 (see --help)" ;;
        esac
        shift
    done

    if "${stop}"; then
        stop_sidecar
        exit 0
    fi

    # Guard: port must be free.
    local existing_pid
    existing_pid="$(pid_on_port)"
    if [[ -n "${existing_pid}" ]]; then
        die "Port ${PORT} is already in use (PID ${existing_pid}). Stop it first with: $0 --stop"
    fi

    if "${foreground}"; then
        start_foreground
    else
        start_background
    fi
}

main "$@"
