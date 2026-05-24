#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start_f5_tts.sh — Start the F5-TTS FastAPI wrapper
#
# Usage:
#   ./start_f5_tts.sh              # Start wrapper only
#   ./start_f5_tts.sh --with-gradio # Also start the F5-TTS Gradio webui
#   ./start_f5_tts.sh --install     # Install dependencies first
#
# Environment variables:
#   F5_TTS_GRADIO_URL            — Gradio API URL (default: http://localhost:5000)
#   F5_TTS_WRAPPER_PORT          — Wrapper port (default: 5050)
#   F5_TTS_REQUEST_TIMEOUT       — Request timeout in seconds (default: 120)
#   F5_TTS_VOICE_PROFILES_DIR    — Directory for voice profile .wav files
#   F5_TTS_LOG_LEVEL             — Log level: DEBUG, INFO, WARNING, ERROR
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${SCRIPT_DIR}/.f5_tts_wrapper.pid"
LOG_FILE="${SCRIPT_DIR}/f5_tts_wrapper.log"

# Defaults
WRAPPER_PORT="${F5_TTS_WRAPPER_PORT:-5050}"
GRADIO_URL="${F5_TTS_GRADIO_URL:-http://localhost:5000}"
LOG_LEVEL="${F5_TTS_LOG_LEVEL:-INFO}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ─── Parse Arguments ────────────────────────────────────────────────────────

INSTALL_DEPS=false
WITH_GRADIO=false

for arg in "$@"; do
    case "$arg" in
        --install)     INSTALL_DEPS=true ;;
        --with-gradio) WITH_GRADIO=true ;;
        --stop)        stop_wrapper; exit 0 ;;
        --status)      check_status; exit 0 ;;
        --help|-h)     usage; exit 0 ;;
        *)             log_error "Unknown argument: $arg"; usage; exit 1 ;;
    esac
done

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --install       Install Python dependencies before starting"
    echo "  --with-gradio   Also start the F5-TTS Gradio webui on port 5000"
    echo "  --stop          Stop a running wrapper instance"
    echo "  --status        Check if the wrapper is running"
    echo "  --help          Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  F5_TTS_WRAPPER_PORT       Wrapper port (default: 5050)"
    echo "  F5_TTS_GRADIO_URL         Gradio API URL (default: http://localhost:5000)"
    echo "  F5_TTS_VOICE_PROFILES_DIR Directory for voice profiles"
    echo "  F5_TTS_LOG_LEVEL          Log level (default: INFO)"
}

# ─── Functions ───────────────────────────────────────────────────────────────

check_status() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            log_info "F5-TTS wrapper is running (PID: $PID, port: $WRAPPER_PORT)"
            return 0
        else
            log_warn "Stale PID file found (PID: $PID). Cleaning up."
            rm -f "$PID_FILE"
            return 1
        fi
    else
        log_warn "F5-TTS wrapper is not running"
        return 1
    fi
}

stop_wrapper() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            log_info "Stopping F5-TTS wrapper (PID: $PID)..."
            kill "$PID" 2>/dev/null || true
            sleep 2
            # Force kill if still running
            if kill -0 "$PID" 2>/dev/null; then
                log_warn "Force killing..."
                kill -9 "$PID" 2>/dev/null || true
            fi
            log_info "Wrapper stopped."
        else
            log_warn "Process $PID not running. Cleaning up PID file."
        fi
        rm -f "$PID_FILE"
    else
        log_warn "No PID file found. Wrapper may not be running."
    fi
}

install_dependencies() {
    log_info "Installing Python dependencies..."
    pip install --quiet --upgrade pip
    pip install --quiet -r "${SCRIPT_DIR}/requirements.txt"
    log_info "Dependencies installed."
}

start_gradio() {
    log_info "Starting F5-TTS Gradio webui on port 5000..."
    nohup f5-tts_webui --port 5000 > "${SCRIPT_DIR}/f5_tts_gradio.log" 2>&1 &
    GRADIO_PID=$!
    log_info "Gradio webui starting (PID: $GRADIO_PID). Waiting for it to be ready..."

    # Wait for Gradio to come up (up to 60 seconds)
    for i in $(seq 1 30); do
        if curl -s -o /dev/null -w '' "http://localhost:5000/" 2>/dev/null; then
            log_info "Gradio webui is ready!"
            return 0
        fi
        sleep 2
        echo -n "."
    done
    echo ""
    log_warn "Gradio webui did not respond within 60s. Continuing anyway."
    return 0
}

start_wrapper() {
    # Check if already running
    if check_status 2>/dev/null; then
        log_warn "Wrapper is already running. Use --stop first."
        exit 0
    fi

    log_info "Starting F5-TTS FastAPI wrapper..."
    log_info "  Port:         $WRAPPER_PORT"
    log_info "  Gradio URL:   $GRADIO_URL"
    log_info "  Log level:    $LOG_LEVEL"
    log_info "  Log file:     $LOG_FILE"

    export F5_TTS_GRADIO_URL="$GRADIO_URL"
    export F5_TTS_WRAPPER_PORT="$WRAPPER_PORT"
    export F5_TTS_LOG_LEVEL="$LOG_LEVEL"

    # Start the wrapper in the background
    nohup python "${SCRIPT_DIR}/f5_tts_api.py" > "$LOG_FILE" 2>&1 &
    WRAPPER_PID=$!
    echo "$WRAPPER_PID" > "$PID_FILE"

    log_info "Wrapper starting (PID: $WRAPPER_PID)..."

    # Wait for the wrapper to come up
    for i in $(seq 1 20); do
        if curl -s -o /dev/null -w '' "http://localhost:${WRAPPER_PORT}/health" 2>/dev/null; then
            log_info "Wrapper is ready at http://localhost:${WRAPPER_PORT}/"
            log_info "  API docs:  http://localhost:${WRAPPER_PORT}/docs"
            log_info "  Health:    http://localhost:${WRAPPER_PORT}/health"
            return 0
        fi
        sleep 1
        echo -n "."
    done
    echo ""
    log_error "Wrapper did not start within 20s. Check logs at $LOG_FILE"
    exit 1
}

# ─── Main ────────────────────────────────────────────────────────────────────

echo -e "${CYAN}"
echo "  ┌─────────────────────────────────────────┐"
echo "  │     F5-TTS Wrapper — Project Kiwul      │"
echo "  └─────────────────────────────────────────┘"
echo -e "${NC}"

if [ "$INSTALL_DEPS" = true ]; then
    install_dependencies
fi

if [ "$WITH_GRADIO" = true ]; then
    start_gradio
fi

start_wrapper
