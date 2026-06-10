#!/usr/bin/env bash
# =============================================================================
# Agent Deck — One-Command Installer
# =============================================================================
#
# Run this to install Hermes + Agent Deck, start both, and open your browser:
#
#   curl -fsSL https://raw.githubusercontent.com/victorv2i/hermes-agent-deck/main/install.sh | bash
#
# Or, if you already have the repo:
#
#   bash install.sh
#   bash install.sh --dry-run    # print every step without doing anything
#
# Supported platforms:
#   macOS   arm64 (Apple Silicon) and x64 (Intel Mac)
#   Linux   x64 and arm64 (Ubuntu, Debian, Fedora, Arch, and most others)
#   WSL2    use this script unchanged (it runs as Linux)
#   Windows native → install.ps1 coming soon (see bottom of this script)
#
# What this script does:
#   1. Checks your operating system, internet connection, and that git is installed
#   2. Installs Hermes via its own official installer
#   3. Checks Node.js (you install it if missing -- cannot do it for you)
#   4. Installs pnpm if missing
#   5. Clones or updates Agent Deck, builds the web client
#   6. Checks the ports (if 7878 is taken, picks the next free port automatically)
#   7. Starts the Hermes gateway (port 8642) and dashboard (port 9119) as
#      persistent services, same as Agent Deck below
#   8. Starts Agent Deck as a persistent service (systemd user units on Linux,
#      launchd on macOS) -- so everything comes back after a reboot
#   9. Opens your browser to http://127.0.0.1:7878
#  10. Prints a bookmark reminder and stop/start commands
#
# Idempotent: safe to re-run. Already-installed components are updated, not
# re-installed from scratch. Already-running services are restarted cleanly.
#
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Cancellation trap — fires on Ctrl-C (SIGINT) or SIGTERM.
# Prints a clear, actionable message and exits cleanly.  Service registration
# writes each unit/plist file in one shot and re-running the installer simply
# rewrites it, so an interrupt cannot leave a half-written service.  Other
# steps do not write partial state either (pnpm install is atomic per-package,
# git clone is atomic per-file).  The one non-atomic step is the web build
# (produces apps/web/dist); if interrupted mid-build, re-running the installer
# rebuilds from scratch (safe).
# ---------------------------------------------------------------------------
_CANCELLED=0
_cleanup_on_interrupt() {
  _CANCELLED=1
  printf "\n\n  %sCancelled.%s Nothing was left half-installed.\n" "${_YELLOW:-}" "${_RESET:-}" >&2
  printf "  Re-run to resume from the beginning:\n\n" >&2
  printf "    bash install.sh\n\n" >&2
  exit 130
}
trap '_cleanup_on_interrupt' INT TERM

# ---------------------------------------------------------------------------
# Configuration — adjust these env vars before running if needed
# ---------------------------------------------------------------------------
# Where to clone Agent Deck (defaults to ~/.local/share/agent-deck)
AGENT_DECK_DIR="${AGENT_DECK_DIR:-$HOME/.local/share/agent-deck}"
# The repo URL (set the AGENT_DECK_REPO env var to override).
AGENT_DECK_REPO="${AGENT_DECK_REPO:-https://github.com/victorv2i/hermes-agent-deck.git}"
# Agent Deck web UI port. If this port is taken by something else, the installer
# picks the next free port automatically (set AGENT_DECK_PORT to choose one).
AGENT_DECK_PORT="${AGENT_DECK_PORT:-7878}"
# Hermes dashboard port — 9119, the STOCK hermes dashboard default (and Agent
# Deck's built-in default), so the started dashboard + the deck agree with no env.
HERMES_DASHBOARD_PORT="9119"
# Hermes gateway (chat API) port — 8642, the STOCK hermes gateway default. The
# gateway is started with no --port so it binds this default; Agent Deck reads the
# gateway port from the user's ~/.hermes/config.yaml (API_SERVER_PORT) and falls
# back to this same stock 8642, so the BFF and the gateway agree with no env.
HERMES_GATEWAY_PORT="8642"
# Node.js minimum major version required
NODE_MIN=20
# pnpm minimum major version required
PNPM_MIN=10
# The exact pnpm this repo pins in package.json's packageManager field. Keep the
# two in sync: a corepack-shimmed NEWER pnpm refuses to run a project pinned to an
# older major (verified on a clean Ubuntu 24.04: pnpm 11 + a pnpm@10 pin fails hard).
PNPM_PIN="10.33.3"
# corepack interactively prompts before its first pnpm download; under
# `curl ... | bash` stdin is the script itself, so the prompt would garble or fail.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Set to 1 by the start steps when the gateway/dashboard end up registered as
# services managed by this installer (used for honest stop/start instructions
# at the end -- an already-running Hermes we merely reused is not listed).
GATEWAY_MANAGED=0
DASHBOARD_MANAGED=0

# ---------------------------------------------------------------------------
# Dry-run mode
# ---------------------------------------------------------------------------
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      echo "Usage: bash install.sh [--dry-run]"
      echo ""
      echo "  --dry-run   Print every step without executing any of them."
      echo "  --help      Show this message."
      exit 0
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
# Plain, non-jargon output. No raw stack traces reach the user.

# Colors (only if the terminal supports them and we're not in dry-run output)
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && tput colors >/dev/null 2>&1; then
  _BOLD="$(tput bold)"
  _GREEN="$(tput setaf 2)"
  _YELLOW="$(tput setaf 3)"
  _RED="$(tput setaf 1)"
  _RESET="$(tput sgr0)"
else
  _BOLD=""; _GREEN=""; _YELLOW=""; _RED=""; _RESET=""
fi

log_info()    { printf "  %s\n" "$*"; }
log_success() { printf "  %s%s%s\n" "${_GREEN}" "$*" "${_RESET}"; }
log_warn()    { printf "  %s%s%s\n" "${_YELLOW}WARNING: " "$*" "${_RESET}" >&2; }
log_error()   { printf "\n  %s%s%s\n\n" "${_RED}ERROR: " "$*" "${_RESET}" >&2; }
log_step()    { printf "\n  %s%s%s\n" "${_BOLD}" "$*" "${_RESET}"; }
log_dry()     { printf "  [DRY-RUN] %s\n" "$*"; }

# When --dry-run is active, wrap side-effecting commands.
# Usage: run <description> <command> [args...]
run() {
  local desc="$1"; shift
  if [ "$DRY_RUN" -eq 1 ]; then
    log_dry "$desc"
    log_dry "  -> $*"
    return 0
  fi
  "$@"
}

# ---------------------------------------------------------------------------
# Step 0: Print banner
# ---------------------------------------------------------------------------
print_banner() {
  printf "\n"
  printf "  +----------------------------------------------------------+\n"
  printf "  |                                                          |\n"
  printf "  |   Agent Deck Installer                                   |\n"
  printf "  |   The Hermes web UI -- easy on-ramp for everyone         |\n"
  printf "  |                                                          |\n"
  printf "  +----------------------------------------------------------+\n"
  printf "\n"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  %s[DRY-RUN MODE]%s Nothing will be installed or changed.\n\n" \
      "${_YELLOW}" "${_RESET}"
  fi
  log_info "This installer will set up Hermes and Agent Deck on your computer."
  log_info "It takes about 5-10 minutes the first time (mostly downloading)."
  log_info "You can safely re-run it to update."
  printf "\n"
}

# ---------------------------------------------------------------------------
# Step 1: Detect OS and architecture
# ---------------------------------------------------------------------------
detect_os() {
  log_step "[1/11] Checking your operating system..."

  local os_raw
  os_raw="$(uname -s)"
  local arch_raw
  arch_raw="$(uname -m)"

  case "$os_raw" in
    Darwin*)
      OS="macos"
      case "$arch_raw" in
        arm64) ARCH="arm64" ;;
        x86_64) ARCH="x64" ;;
        *)
          log_error "Unrecognised Mac architecture: $arch_raw. Please file an issue."
          exit 1
          ;;
      esac
      ;;
    Linux*)
      # Detect WSL2 for an informational note
      if grep -qi microsoft /proc/version 2>/dev/null; then
        WSL2=1
      else
        WSL2=0
      fi
      OS="linux"
      case "$arch_raw" in
        x86_64)  ARCH="x64" ;;
        aarch64) ARCH="arm64" ;;
        *)
          log_warn "Unrecognised Linux architecture: $arch_raw. Continuing, it may work."
          ARCH="unknown"
          ;;
      esac
      ;;
    CYGWIN*|MINGW*|MSYS*)
      log_error "Native Windows detected."
      printf "\n"
      log_info "A Windows installer (install.ps1) is coming soon."
      log_info "For now, the best path is WSL2 (Windows Subsystem for Linux):"
      log_info ""
      log_info "  1. Open PowerShell as Administrator and run:"
      log_info "       wsl --install"
      log_info "  2. Restart your computer."
      log_info "  3. Open the Ubuntu app and run this installer inside WSL2."
      log_info ""
      log_info "  Or run this in PowerShell (Hermes only, no Agent Deck yet):"
      log_info "    iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)"
      printf "\n"
      exit 1
      ;;
    *)
      log_error "Unrecognised operating system: $os_raw"
      log_info "This installer supports macOS (arm64/x64) and Linux (x64/arm64)."
      exit 1
      ;;
  esac

  if [ "$DRY_RUN" -eq 0 ]; then
    log_success "Operating system: $os_raw ($ARCH)"
    if [ "${WSL2:-0}" -eq 1 ]; then
      log_info "Running inside WSL2. Note: default WSL2 has no 'systemctl --user', so"
      log_info "Agent Deck and Hermes won't auto-start on boot. Re-run this installer"
      log_info "after a restart, or enable systemd in /etc/wsl.conf."
    fi
  else
    log_dry "Would detect OS=$OS ARCH=$ARCH and continue."
  fi
}

# ---------------------------------------------------------------------------
# Step 2: Check network connectivity
# ---------------------------------------------------------------------------
check_network() {
  log_step "[2/11] Checking internet connection..."
  if [ "$DRY_RUN" -eq 1 ]; then
    log_dry "Would probe https://github.com for connectivity."
    return 0
  fi
  if ! curl -fsSI --max-time 8 https://github.com >/dev/null 2>&1; then
    log_error "Cannot reach github.com. Please check your internet connection."
    log_info "Fix: make sure you are connected to the internet, then re-run:"
    log_info "  bash install.sh"
    exit 1
  fi
  log_success "Internet connection: OK"
}

# ---------------------------------------------------------------------------
# Step 3: Check git (needed to download Hermes and Agent Deck)
# ---------------------------------------------------------------------------
check_git() {
  log_step "[3/11] Checking git..."

  if [ "$DRY_RUN" -eq 1 ]; then
    log_dry "Would check that git is installed (it downloads Hermes and Agent Deck)."
    log_dry "If missing, would print installation instructions and exit."
    return 0
  fi

  if [ "$OS" = "macos" ]; then
    # On a fresh Mac, /usr/bin/git exists but is only a stub: the first git
    # command pops the Xcode Command Line Tools dialog. Check for the real
    # tools up front so that dialog never interrupts a later step.
    if ! xcode-select -p >/dev/null 2>&1; then
      log_error "git is not installed (the Xcode Command Line Tools are missing)."
      log_info "This installer uses git to download Hermes and Agent Deck."
      log_info ""
      log_info "Install the tools with:"
      log_info "  xcode-select --install"
      log_info ""
      log_info "A dialog will open. Click Install, wait for it to finish, then re-run:"
      log_info "  bash install.sh"
      exit 1
    fi
  fi

  if ! command -v git >/dev/null 2>&1; then
    log_error "git is not installed."
    log_info "This installer uses git to download Hermes and Agent Deck."
    log_info ""
    log_info "Install it:"
    case "$OS" in
      macos)
        log_info "  xcode-select --install"
        ;;
      linux)
        log_info "  Ubuntu/Debian:  sudo apt-get install -y git"
        log_info "  Fedora:         sudo dnf install git"
        log_info "  Arch:           sudo pacman -S git"
        ;;
    esac
    log_info ""
    log_info "After installing git, re-run:"
    log_info "  bash install.sh"
    exit 1
  fi

  local git_ver
  git_ver="$(git --version 2>/dev/null || echo 'git (version unknown)')"
  log_success "$git_ver"
}

# ---------------------------------------------------------------------------
# Step 4: Install Hermes (via its own official installer)
# ---------------------------------------------------------------------------
# Source confirmed: https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh
# That script: installs uv, clones NousResearch/hermes-agent to ~/.hermes/hermes-agent,
# creates a venv, runs `uv pip install -e '.[all]'`, and writes a hermes shim to
# ~/.local/bin/hermes. We chain to it verbatim — no reimplementation.
HERMES_INSTALL_URL="https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh"

install_hermes() {
  log_step "[4/11] Checking Hermes agent..."

  # Ensure ~/.local/bin is on PATH for this session (Hermes installs there)
  export PATH="$HOME/.local/bin:$PATH"

  if command -v hermes >/dev/null 2>&1; then
    local ver
    ver="$(hermes --version 2>/dev/null || echo 'unknown')"
    if [ "$DRY_RUN" -eq 1 ]; then
      log_dry "Hermes already installed ($ver). Would skip Hermes install."
      return 0
    fi
    log_success "Hermes already installed ($ver) -- skipping"
    return 0
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    log_dry "Hermes not found. Would run:"
    log_dry "  curl -fsSL $HERMES_INSTALL_URL | bash -s -- --skip-setup"
    log_dry "  (--skip-setup defers provider/model setup to the Agent Deck wizard)"
    return 0
  fi

  log_info "Hermes is not installed. Installing now (2-5 minutes)..."
  log_info "Using the official Hermes installer from NousResearch."
  log_info ""

  # --skip-setup: skip the interactive wizard; Agent Deck's onboarding handles it.
  # We do NOT pass --skip-browser because the gateway may need Node for its HTTP layer.
  if ! curl -fsSL "$HERMES_INSTALL_URL" | bash -s -- --skip-setup; then
    log_error "The Hermes installer reported an error (see output above)."
    log_info "Fix: address the error shown above, then re-run:"
    log_info "  bash install.sh"
    log_info "Hermes documentation: https://hermes-agent.nousresearch.com/docs/"
    exit 1
  fi

  # Reload PATH in case the shim was just written
  export PATH="$HOME/.local/bin:$PATH"

  if ! command -v hermes >/dev/null 2>&1; then
    log_error "Hermes installed but the 'hermes' command is not on your PATH."
    log_info "Fix: open a new terminal (so PATH is reloaded), then re-run:"
    log_info "  bash install.sh"
    log_info "Or first run:  source ~/.bashrc   (or: source ~/.zshrc)"
    exit 1
  fi

  local ver
  ver="$(hermes --version 2>/dev/null || echo 'unknown')"
  log_success "Hermes installed ($ver)"
}

# ---------------------------------------------------------------------------
# Step 5: Check Node.js (required to build the web client)
# ---------------------------------------------------------------------------
check_node() {
  log_step "[5/11] Checking Node.js..."

  if [ "$DRY_RUN" -eq 1 ]; then
    log_dry "Would check that Node.js >= $NODE_MIN is installed."
    log_dry "If missing, would print installation instructions and exit."
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    log_error "Node.js is not installed."
    log_info "Agent Deck's web interface requires Node.js $NODE_MIN or newer to build."
    log_info ""
    log_info "Install it from: https://nodejs.org/en/download"
    log_info ""
    log_info "Quick options:"
    case "$OS" in
      macos)
        log_info "  Homebrew:  brew install node"
        log_info "  Or download the macOS installer from https://nodejs.org"
        ;;
      linux)
        log_info "  Ubuntu/Debian:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
        log_info "                  sudo apt-get install -y nodejs"
        log_info "  Fedora:         sudo dnf install nodejs"
        log_info "  Arch:           sudo pacman -S nodejs npm"
        log_info "  Or use nvm:     https://github.com/nvm-sh/nvm"
        ;;
    esac
    log_info ""
    log_info "After installing Node.js, re-run:"
    log_info "  bash install.sh"
    exit 1
  fi

  local node_ver
  node_ver="$(node --version | tr -d 'v')"
  local node_major="${node_ver%%.*}"
  local node_minor
  node_minor="$(printf '%s' "$node_ver" | cut -d. -f2)"

  # The web build (Vite 8 / Rolldown) needs Node >= 20.19 on the 20.x line — a plain
  # "major >= 20" check would pass Node 20.0-20.18 and then fail cryptically deep in
  # the build. Enforce the real floor here so a too-old Node fails fast + clearly.
  if [ "$node_major" -lt "$NODE_MIN" ] ||
    { [ "$node_major" -eq 20 ] && [ "${node_minor:-0}" -lt 19 ]; }; then
    log_error "Node.js v$node_ver is too old. Agent Deck needs Node.js 20.19+ (or 22.12+)."
    log_info "Update from: https://nodejs.org/en/download"
    log_info "After updating, re-run:"
    log_info "  bash install.sh"
    exit 1
  fi

  log_success "Node.js v$node_ver"
}

# ---------------------------------------------------------------------------
# Step 6: Check / install pnpm (the package manager this monorepo uses)
# ---------------------------------------------------------------------------
check_pnpm() {
  log_step "[6/11] Checking pnpm package manager..."

  if [ "$DRY_RUN" -eq 1 ]; then
    log_dry "Would check pnpm >= $PNPM_MIN is installed. If missing, would enable it via corepack."
    return 0
  fi

  # Prefer corepack (bundled with Node): it needs no writable global npm prefix (a
  # common failure for `npm install -g`). Activate the EXACT version the repo pins,
  # never latest: a corepack-shimmed newer pnpm refuses a project pinned to an older
  # major instead of switching to it. Fall back to a global npm install only if
  # corepack isn't usable.
  if ! command -v pnpm >/dev/null 2>&1; then
    log_info "pnpm not found. Enabling it via corepack (bundled with Node)..."
    if ! { command -v corepack >/dev/null 2>&1 &&
      corepack enable >/dev/null 2>&1 &&
      corepack prepare "pnpm@${PNPM_PIN}" --activate >/dev/null 2>&1; }; then
      if ! npm install -g "pnpm@${PNPM_PIN}" >/dev/null 2>&1; then
        log_error "Could not install pnpm."
        log_info "Fix: enable it via corepack (bundled with Node), then re-run:"
        log_info "  corepack enable && corepack prepare pnpm@${PNPM_PIN} --activate"
        log_info "  bash install.sh"
        exit 1
      fi
    fi
  fi

  local pnpm_ver
  pnpm_ver="$(pnpm --version 2>/dev/null || echo '0')"
  local pnpm_major="${pnpm_ver%%.*}"

  # A too-old pnpm can't read this repo's lockfile (lockfileVersion 9) and would fail
  # with a cryptic error during install — so upgrade, and HARD-EXIT if that fails
  # rather than warn-and-continue into a confusing lockfile error.
  if [ "$pnpm_major" -lt "$PNPM_MIN" ]; then
    log_info "Upgrading pnpm from $pnpm_ver (this repo's lockfile needs pnpm $PNPM_MIN+)..."
    { corepack enable >/dev/null 2>&1 &&
      corepack prepare "pnpm@${PNPM_PIN}" --activate >/dev/null 2>&1; } ||
      npm install -g "pnpm@${PNPM_PIN}" >/dev/null 2>&1 || true
    pnpm_ver="$(pnpm --version 2>/dev/null || echo "$pnpm_ver")"
    pnpm_major="${pnpm_ver%%.*}"
    if [ "$pnpm_major" -lt "$PNPM_MIN" ]; then
      log_error "pnpm $pnpm_ver is too old (the lockfile needs pnpm $PNPM_MIN+) and the upgrade failed."
      log_info "Fix: corepack enable && corepack prepare pnpm@${PNPM_PIN} --activate ; then re-run."
      exit 1
    fi
  fi

  log_success "pnpm $pnpm_ver"
}

# ---------------------------------------------------------------------------
# Step 7: Clone or update Agent Deck, then build the web client
# ---------------------------------------------------------------------------
install_agent_deck() {
  log_step "[7/11] Installing Agent Deck..."

  # ---- Clone or update ----
  if [ -d "$AGENT_DECK_DIR/.git" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      log_dry "Agent Deck already at $AGENT_DECK_DIR. Would run: git pull origin main"
    else
      log_info "Agent Deck already installed at $AGENT_DECK_DIR -- updating..."
      if ! git -C "$AGENT_DECK_DIR" pull --ff-only origin main 2>/dev/null; then
        log_warn "Could not pull the latest update (local changes or network issue)."
        log_info "Continuing with the existing version."
      fi
    fi
  else
    if [ "$DRY_RUN" -eq 1 ]; then
      log_dry "Would clone $AGENT_DECK_REPO to $AGENT_DECK_DIR"
    else
      log_info "Downloading Agent Deck to $AGENT_DECK_DIR ..."
      mkdir -p "$(dirname "$AGENT_DECK_DIR")"
      if ! git clone "$AGENT_DECK_REPO" "$AGENT_DECK_DIR" 2>&1; then
        log_error "Could not download Agent Deck."
        log_info "The repository URL is: $AGENT_DECK_REPO"
        log_info "Fix: check your internet connection and that git is installed, then re-run:"
        log_info "  bash install.sh"
        exit 1
      fi
    fi
  fi

  # ---- Install dependencies ----
  if [ "$DRY_RUN" -eq 1 ]; then
    log_dry "Would run: pnpm --dir $AGENT_DECK_DIR install --frozen-lockfile"
  else
    log_info "Installing dependencies (downloading packages from npm)..."
    if ! pnpm --dir "$AGENT_DECK_DIR" install --frozen-lockfile 2>&1; then
      log_error "Dependency installation failed."
      log_info "Fix: check your internet connection, then re-run:"
      log_info "  bash install.sh"
      log_info "Or, to retry just the dependency step:"
      log_info "  cd $AGENT_DECK_DIR && pnpm install --frozen-lockfile"
      exit 1
    fi
  fi

  # ---- Build the web client ----
  # The React/Vite web client MUST be compiled on your machine. This is normal
  # for this kind of software -- it produces the files your browser will load.
  # Takes 1-4 minutes depending on machine speed.
  if [ "$DRY_RUN" -eq 1 ]; then
    log_dry "Would build the web interface:"
    log_dry "  pnpm --dir $AGENT_DECK_DIR --filter @agent-deck/web build"
    log_dry "  (1-4 min on a slow machine; produces $AGENT_DECK_DIR/apps/web/dist)"
  else
    log_info "Building the web interface (1-4 minutes -- please wait)..."
    if ! pnpm --dir "$AGENT_DECK_DIR" --filter '@agent-deck/web' build 2>&1; then
      log_error "Web interface build failed."
      log_info "Fix: make sure Node.js $NODE_MIN+ is installed, then re-run:"
      log_info "  bash install.sh"
      log_info "Or, to retry just the build step:"
      log_info "  cd $AGENT_DECK_DIR && pnpm --filter @agent-deck/web build"
      exit 1
    fi
    log_success "Agent Deck built"
  fi
}

# ---------------------------------------------------------------------------
# Step 8: Check ports
# ---------------------------------------------------------------------------
# Ports we need:
#   7878  Agent Deck web UI (or the next free port if 7878 is taken)
#   9119  Hermes dashboard (started on this port so Agent Deck finds it by default)
#   8642  Hermes gateway / chat API
#
# The Hermes ports are handled at the start step: an already-running gateway or
# dashboard there is reused, not treated as an error.

_port_in_use() {
  # Returns 0 (true) if the port is in use, 1 (false) if free.
  # Tries lsof first (most accurate), falls back to ss, then /dev/tcp.
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -tlnH "sport = :$port" 2>/dev/null | grep -q ":$port"
    return $?
  fi
  # Last resort: attempt a TCP connection (not reliable for "listening" check)
  ( echo >/dev/tcp/127.0.0.1/"$port" ) 2>/dev/null
  return $?
}

_port_occupant() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN -Fc 2>/dev/null | grep '^c' | head -1 | cut -c2- || echo "unknown"
  else
    echo "unknown"
  fi
}

_deck_service_active() {
  # Is the Agent Deck service this installer manages currently running?
  case "$OS" in
    linux) command -v systemctl >/dev/null 2>&1 &&
      systemctl --user is-active agent-deck.service >/dev/null 2>&1 ;;
    macos) launchctl list io.agent-deck.app >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

_deck_responds() {
  # Is whatever listens on this port an Agent Deck (vs an unrelated process)?
  curl -fsSo /dev/null --max-time 2 \
    "http://127.0.0.1:$1/api/agent-deck/health" 2>/dev/null
}

check_ports() {
  log_step "[8/11] Checking ports..."

  case "$AGENT_DECK_PORT" in
    ''|*[!0-9]*)
      log_error "AGENT_DECK_PORT must be a number, got: '$AGENT_DECK_PORT'"
      log_info "Fix: pick a numeric port, for example:"
      log_info "  AGENT_DECK_PORT=7878 bash install.sh"
      exit 1
      ;;
  esac

  if [ "$DRY_RUN" -eq 1 ]; then
    log_dry "Would check port $AGENT_DECK_PORT for Agent Deck (set AGENT_DECK_PORT to choose another)."
    log_dry "If the Agent Deck service already holds it, the restart simply takes over."
    log_dry "If anything else holds it, would scan the next 20 ports, pick the first free"
    log_dry "one, print the new address, and write it into the service."
    log_dry "Ports $HERMES_GATEWAY_PORT (gateway) and $HERMES_DASHBOARD_PORT (dashboard) are checked at their start step;"
    log_dry "an already-running Hermes there is reused, not treated as an error."
    return 0
  fi

  if ! _port_in_use "$AGENT_DECK_PORT"; then
    log_success "Port $AGENT_DECK_PORT is free for Agent Deck"
    return 0
  fi

  if _deck_service_active; then
    # Our own service from a previous run holds the port. Restarting the
    # service later frees and re-takes it, so the port stays the same.
    # The health probe is messaging only: a slow-starting service that has
    # not answered yet is still ours, so it must not change the decision.
    if _deck_responds "$AGENT_DECK_PORT"; then
      log_success "Port $AGENT_DECK_PORT is held by the Agent Deck service -- the restart will take over"
    else
      log_success "Port $AGENT_DECK_PORT is held by the Agent Deck service (still starting up) -- the restart will take over"
    fi
    return 0
  fi

  if _deck_responds "$AGENT_DECK_PORT"; then
    log_error "An Agent Deck is already running on port $AGENT_DECK_PORT, but not as the managed service."
    log_info "It was probably started by hand (pnpm start) or by an earlier run."
    log_info "Fix: stop it (or restart your computer), then re-run:"
    log_info "  bash install.sh"
    log_info "Or keep it and install on a different port:"
    log_info "  AGENT_DECK_PORT=7879 bash install.sh"
    exit 1
  fi

  # Something unrelated owns the port. Pick the next free one automatically.
  local occupant
  occupant="$(_port_occupant "$AGENT_DECK_PORT")"
  log_info "Port $AGENT_DECK_PORT is already in use by: $occupant"
  log_info "Picking the next free port instead..."
  local candidate=$((AGENT_DECK_PORT + 1))
  local limit=$((AGENT_DECK_PORT + 20))
  local picked=""
  while [ "$candidate" -le "$limit" ]; do
    if ! _port_in_use "$candidate"; then
      picked="$candidate"
      break
    fi
    candidate=$((candidate + 1))
  done
  if [ -z "$picked" ]; then
    log_error "No free port found between $((AGENT_DECK_PORT + 1)) and $limit."
    log_info "Fix: stop some of the processes using those ports, or pick a port yourself:"
    log_info "  AGENT_DECK_PORT=7901 bash install.sh"
    exit 1
  fi
  AGENT_DECK_PORT="$picked"
  log_success "Agent Deck will use port $AGENT_DECK_PORT instead"
  log_info "Your address will be: http://127.0.0.1:$AGENT_DECK_PORT"
  log_info "(The service remembers this port, so it stays the same after reboots.)"
}

# ---------------------------------------------------------------------------
# Steps 9 + 10: Start the Hermes gateway + dashboard, then Agent Deck.
# All three are registered the same way: systemd user units on Linux, launchd
# agents on macOS, so everything comes back after a reboot. On systems without
# a systemd user session (e.g. default WSL2) they fall back to plain background
# processes, with an honest note that those do not restart by themselves.
# ---------------------------------------------------------------------------

_hermes_bin() {
  # Resolve the hermes binary path — prefer ~/.local/bin/hermes
  if command -v hermes >/dev/null 2>&1; then
    command -v hermes
  elif [ -x "$HOME/.local/bin/hermes" ]; then
    echo "$HOME/.local/bin/hermes"
  else
    echo "hermes"  # fallback, will error if not found
  fi
}

_node_bin() {
  command -v node || echo "node"
}

_pnpm_bin() {
  command -v pnpm || echo "pnpm"
}

_gateway_service_active() {
  case "$OS" in
    linux) command -v systemctl >/dev/null 2>&1 &&
      systemctl --user is-active agent-deck-hermes-gateway.service >/dev/null 2>&1 ;;
    macos) launchctl list io.agent-deck.hermes-gateway >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

_dashboard_service_active() {
  case "$OS" in
    linux) command -v systemctl >/dev/null 2>&1 &&
      systemctl --user is-active agent-deck-hermes-dashboard.service >/dev/null 2>&1 ;;
    macos) launchctl list io.agent-deck.hermes-dashboard >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

_systemd_user_available() {
  command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1
}

_write_gateway_systemd_unit() {
  # Write (or overwrite) the systemd user unit for the Hermes gateway.
  # Named agent-deck-hermes-gateway (not hermes-gateway) so it can never
  # overwrite a unit you wrote yourself.
  local hermes
  hermes="$(_hermes_bin)"

  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/agent-deck-hermes-gateway.service" <<EOF
[Unit]
Description=Hermes gateway (chat engine) for Agent Deck
After=network.target

[Service]
Type=simple
Environment="PATH=${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=${hermes} gateway
Restart=on-failure
RestartSec=5
StandardOutput=append:${HOME}/.hermes/logs/gateway-agent-deck.log
StandardError=append:${HOME}/.hermes/logs/gateway-agent-deck.log

[Install]
WantedBy=default.target
EOF
}

_write_dashboard_systemd_unit() {
  # Write (or overwrite) the systemd user unit for the Hermes dashboard.
  local hermes
  hermes="$(_hermes_bin)"

  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/agent-deck-hermes-dashboard.service" <<EOF
[Unit]
Description=Hermes dashboard (data API) for Agent Deck
After=network.target

[Service]
Type=simple
Environment="PATH=${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=${hermes} dashboard --port ${HERMES_DASHBOARD_PORT} --no-open
Restart=on-failure
RestartSec=5
StandardOutput=append:${HOME}/.hermes/logs/dashboard-agent-deck.log
StandardError=append:${HOME}/.hermes/logs/dashboard-agent-deck.log

[Install]
WantedBy=default.target
EOF
}

_write_gateway_launchd_plist() {
  # Write (or overwrite) the launchd plist for the Hermes gateway.
  local plist_path="$HOME/Library/LaunchAgents/io.agent-deck.hermes-gateway.plist"
  local hermes
  hermes="$(_hermes_bin)"

  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.agent-deck.hermes-gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>${hermes}</string>
    <string>gateway</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.hermes/logs/gateway-agent-deck.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.hermes/logs/gateway-agent-deck.log</string>
</dict>
</plist>
EOF
  echo "$plist_path"
}

_write_dashboard_launchd_plist() {
  # Write (or overwrite) the launchd plist for the Hermes dashboard.
  local plist_path="$HOME/Library/LaunchAgents/io.agent-deck.hermes-dashboard.plist"
  local hermes
  hermes="$(_hermes_bin)"

  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.agent-deck.hermes-dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>${hermes}</string>
    <string>dashboard</string>
    <string>--port</string>
    <string>${HERMES_DASHBOARD_PORT}</string>
    <string>--no-open</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.hermes/logs/dashboard-agent-deck.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.hermes/logs/dashboard-agent-deck.log</string>
</dict>
</plist>
EOF
  echo "$plist_path"
}

start_hermes_gateway() {
  # The gateway is the chat engine. It must be running before Agent Deck starts.
  # It runs on port 8642 (the stock Hermes default) and is registered as a
  # service the same way Agent Deck is, so it comes back after a reboot.
  log_step "[9/11] Starting the Hermes gateway and dashboard..."
  local hermes
  hermes="$(_hermes_bin)"

  # If a gateway is already answering and it is not the service this installer
  # manages (you may run Hermes your own way), reuse it. We never start a
  # second one or take over something we did not set up.
  if _port_in_use "$HERMES_GATEWAY_PORT" && ! _gateway_service_active; then
    local gw_unit="$HOME/.config/systemd/user/agent-deck-hermes-gateway.service"
    local gw_plist="$HOME/Library/LaunchAgents/io.agent-deck.hermes-gateway.plist"
    if [ "$DRY_RUN" -eq 1 ]; then
      log_dry "A Hermes gateway is already running on port $HERMES_GATEWAY_PORT (not managed by this installer)."
      log_dry "Would reuse it as is and skip registering the gateway service."
      if [ "$OS" = "linux" ] && [ -f "$gw_unit" ]; then
        log_dry "A gateway service from an earlier run is still registered. Would turn off"
        log_dry "its auto-start so it cannot fight your running gateway at next login:"
        log_dry "  systemctl --user disable --now agent-deck-hermes-gateway.service"
      elif [ "$OS" = "macos" ] && [ -f "$gw_plist" ]; then
        log_dry "A gateway service from an earlier run is still registered. Would turn it"
        log_dry "off so it cannot fight your running gateway:"
        log_dry "  launchctl unload $gw_plist"
      fi
      return 0
    fi
    log_success "Hermes gateway already running on port $HERMES_GATEWAY_PORT -- reusing it"
    if [ "$OS" = "linux" ] && [ -f "$gw_unit" ]; then
      systemctl --user disable --now agent-deck-hermes-gateway.service 2>/dev/null || true
      log_info "A gateway service from an earlier run of this installer was still registered."
      log_info "Its auto-start was turned off so it cannot fight your running gateway."
    elif [ "$OS" = "macos" ] && [ -f "$gw_plist" ]; then
      launchctl unload "$gw_plist" 2>/dev/null || true
      rm -f "$gw_plist"
      log_info "A gateway service from an earlier run of this installer was still registered."
      log_info "It was removed so it cannot fight your running gateway."
    fi
    log_info "Note: the running gateway is outside this installer's services, so it will"
    log_info "not restart automatically after a reboot. If chat is dead after a restart,"
    log_info "just re-run this installer; with the port free it registers the gateway as"
    log_info "an auto-restart service."
    return 0
  fi

  case "$OS" in
    linux)
      if _systemd_user_available; then
        if [ "$DRY_RUN" -eq 1 ]; then
          log_dry "Would write $HOME/.config/systemd/user/agent-deck-hermes-gateway.service"
          log_dry "Would run: systemctl --user daemon-reload"
          log_dry "Would run: systemctl --user enable agent-deck-hermes-gateway.service"
          log_dry "Would run: systemctl --user restart agent-deck-hermes-gateway.service"
        else
          mkdir -p "$HOME/.hermes/logs"
          log_info "Starting the Hermes gateway (chat engine) on port $HERMES_GATEWAY_PORT..."
          _write_gateway_systemd_unit
          systemctl --user daemon-reload
          systemctl --user enable agent-deck-hermes-gateway.service
          systemctl --user restart agent-deck-hermes-gateway.service
          GATEWAY_MANAGED=1
          log_success "Hermes gateway started as a systemd user service"
        fi
      else
        if [ "$DRY_RUN" -eq 1 ]; then
          log_dry "No systemd user session available. Would start the gateway with nohup:"
          log_dry "  nohup $hermes gateway > $HOME/.hermes/logs/gateway-agent-deck.log 2>&1 &"
        else
          log_warn "systemd user session not available. Starting the gateway in the background."
          log_warn "It will not restart automatically if it stops. Re-run the installer to restart."
          mkdir -p "$HOME/.hermes/logs"
          nohup "$hermes" gateway \
            > "$HOME/.hermes/logs/gateway-agent-deck.log" 2>&1 &
          log_info "Hermes gateway started in background (PID $!)"
        fi
      fi
      ;;
    macos)
      if [ "$DRY_RUN" -eq 1 ]; then
        log_dry "Would write ~/Library/LaunchAgents/io.agent-deck.hermes-gateway.plist"
        log_dry "Would run: launchctl unload <plist>  (silently, in case it was loaded)"
        log_dry "Would run: launchctl load ~/Library/LaunchAgents/io.agent-deck.hermes-gateway.plist"
      else
        mkdir -p "$HOME/.hermes/logs"
        log_info "Starting the Hermes gateway (chat engine) on port $HERMES_GATEWAY_PORT..."
        local plist_path
        plist_path="$(_write_gateway_launchd_plist)"
        launchctl unload "$plist_path" 2>/dev/null || true
        launchctl load "$plist_path"
        GATEWAY_MANAGED=1
        log_success "Hermes gateway started as a launchd service"
      fi
      ;;
  esac

  if [ "$DRY_RUN" -eq 1 ]; then
    log_dry "Then wait up to 10s for port $HERMES_GATEWAY_PORT to be ready."
    return 0
  fi

  # Wait up to 10s for the gateway to be reachable
  local attempts=0
  while [ "$attempts" -lt 20 ]; do
    if _port_in_use "$HERMES_GATEWAY_PORT"; then
      log_success "Hermes gateway ready on port $HERMES_GATEWAY_PORT"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 0.5
  done

  log_warn "Hermes gateway did not respond on port $HERMES_GATEWAY_PORT within 10s."
  log_info "It may still be starting. Chat may not work until it does."
  log_info "Log: $HOME/.hermes/logs/gateway-agent-deck.log"
}

start_hermes_dashboard() {
  # The dashboard serves sessions, models, config, and provides the session token
  # that Agent Deck needs to access data surfaces. It runs on port 9119 so Agent
  # Deck finds it without any extra configuration, and is registered as a
  # service the same way Agent Deck is, so it comes back after a reboot.
  local hermes
  hermes="$(_hermes_bin)"

  # Same reuse rule as the gateway: an already-running dashboard that this
  # installer does not manage is left alone.
  if _port_in_use "$HERMES_DASHBOARD_PORT" && ! _dashboard_service_active; then
    local db_unit="$HOME/.config/systemd/user/agent-deck-hermes-dashboard.service"
    local db_plist="$HOME/Library/LaunchAgents/io.agent-deck.hermes-dashboard.plist"
    if [ "$DRY_RUN" -eq 1 ]; then
      log_dry "A Hermes dashboard is already running on port $HERMES_DASHBOARD_PORT (not managed by this installer)."
      log_dry "Would reuse it as is and skip registering the dashboard service."
      if [ "$OS" = "linux" ] && [ -f "$db_unit" ]; then
        log_dry "A dashboard service from an earlier run is still registered. Would turn off"
        log_dry "its auto-start so it cannot fight your running dashboard at next login:"
        log_dry "  systemctl --user disable --now agent-deck-hermes-dashboard.service"
      elif [ "$OS" = "macos" ] && [ -f "$db_plist" ]; then
        log_dry "A dashboard service from an earlier run is still registered. Would turn it"
        log_dry "off so it cannot fight your running dashboard:"
        log_dry "  launchctl unload $db_plist"
      fi
      return 0
    fi
    log_success "Hermes dashboard already running on port $HERMES_DASHBOARD_PORT -- reusing it"
    if [ "$OS" = "linux" ] && [ -f "$db_unit" ]; then
      systemctl --user disable --now agent-deck-hermes-dashboard.service 2>/dev/null || true
      log_info "A dashboard service from an earlier run of this installer was still registered."
      log_info "Its auto-start was turned off so it cannot fight your running dashboard."
    elif [ "$OS" = "macos" ] && [ -f "$db_plist" ]; then
      launchctl unload "$db_plist" 2>/dev/null || true
      rm -f "$db_plist"
      log_info "A dashboard service from an earlier run of this installer was still registered."
      log_info "It was removed so it cannot fight your running dashboard."
    fi
    log_info "Note: the running dashboard is outside this installer's services, so it will"
    log_info "not restart automatically after a reboot. Re-run this installer with the"
    log_info "port free to register it as a service."
    return 0
  fi

  case "$OS" in
    linux)
      if _systemd_user_available; then
        if [ "$DRY_RUN" -eq 1 ]; then
          log_dry "Would write $HOME/.config/systemd/user/agent-deck-hermes-dashboard.service"
          log_dry "Would run: systemctl --user daemon-reload"
          log_dry "Would run: systemctl --user enable agent-deck-hermes-dashboard.service"
          log_dry "Would run: systemctl --user restart agent-deck-hermes-dashboard.service"
        else
          mkdir -p "$HOME/.hermes/logs"
          log_info "Starting the Hermes dashboard on port $HERMES_DASHBOARD_PORT..."
          _write_dashboard_systemd_unit
          systemctl --user daemon-reload
          systemctl --user enable agent-deck-hermes-dashboard.service
          systemctl --user restart agent-deck-hermes-dashboard.service
          DASHBOARD_MANAGED=1
          log_success "Hermes dashboard started as a systemd user service"
        fi
      else
        if [ "$DRY_RUN" -eq 1 ]; then
          log_dry "No systemd user session available. Would start the dashboard with nohup:"
          log_dry "  nohup $hermes dashboard --port $HERMES_DASHBOARD_PORT --no-open > $HOME/.hermes/logs/dashboard-agent-deck.log 2>&1 &"
        else
          log_warn "systemd user session not available. Starting the dashboard in the background."
          log_warn "It will not restart automatically if it stops. Re-run the installer to restart."
          mkdir -p "$HOME/.hermes/logs"
          # --no-open: we open the browser to Agent Deck, not the raw Hermes dashboard
          nohup "$hermes" dashboard \
            --port "$HERMES_DASHBOARD_PORT" \
            --no-open \
            > "$HOME/.hermes/logs/dashboard-agent-deck.log" 2>&1 &
          log_info "Hermes dashboard started in background (PID $!)"
        fi
      fi
      ;;
    macos)
      if [ "$DRY_RUN" -eq 1 ]; then
        log_dry "Would write ~/Library/LaunchAgents/io.agent-deck.hermes-dashboard.plist"
        log_dry "Would run: launchctl unload <plist>  (silently, in case it was loaded)"
        log_dry "Would run: launchctl load ~/Library/LaunchAgents/io.agent-deck.hermes-dashboard.plist"
      else
        mkdir -p "$HOME/.hermes/logs"
        log_info "Starting the Hermes dashboard on port $HERMES_DASHBOARD_PORT..."
        local plist_path
        plist_path="$(_write_dashboard_launchd_plist)"
        launchctl unload "$plist_path" 2>/dev/null || true
        launchctl load "$plist_path"
        DASHBOARD_MANAGED=1
        log_success "Hermes dashboard started as a launchd service"
      fi
      ;;
  esac

  if [ "$DRY_RUN" -eq 1 ]; then
    log_dry "Then wait up to 10s for http://127.0.0.1:$HERMES_DASHBOARD_PORT/ to respond."
    return 0
  fi

  # Wait up to 10s for the dashboard to respond
  local attempts=0
  while [ "$attempts" -lt 20 ]; do
    if curl -fsSo /dev/null --max-time 1 "http://127.0.0.1:$HERMES_DASHBOARD_PORT/" 2>/dev/null; then
      log_success "Hermes dashboard ready on port $HERMES_DASHBOARD_PORT"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 0.5
  done

  # A 10s timeout here is not fatal — the dashboard may just be slow to start.
  # Agent Deck retries internally and will show a helpful status once it boots.
  log_warn "Hermes dashboard did not respond within 10s."
  log_info "Agent Deck will keep retrying. Some data surfaces may be empty at first."
  log_info "Dashboard log: $HOME/.hermes/logs/dashboard-agent-deck.log"
}

_write_systemd_unit() {
  # Write (or overwrite) the systemd user unit for Agent Deck.
  local node_bin pnpm_bin
  node_bin="$(_node_bin)"
  pnpm_bin="$(_pnpm_bin)"

  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/agent-deck.service" <<EOF
[Unit]
Description=Agent Deck -- Hermes web UI
After=network.target

[Service]
Type=simple
WorkingDirectory=${AGENT_DECK_DIR}
Environment="PATH=${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin"
Environment="AGENT_DECK_WEB_CLIENT_ROOT=${AGENT_DECK_DIR}/apps/web/dist"
Environment="HERMES_GATEWAY_URL=http://127.0.0.1:${HERMES_GATEWAY_PORT}"
Environment="HERMES_DASHBOARD_URL=http://127.0.0.1:${HERMES_DASHBOARD_PORT}"
Environment="HERMES_DASHBOARD_HOST=127.0.0.1:${HERMES_DASHBOARD_PORT}"
Environment="AGENT_DECK_PORT=${AGENT_DECK_PORT}"
ExecStart=${node_bin} ${pnpm_bin} --filter @agent-deck/server exec tsx src/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=append:${HOME}/.hermes/logs/agent-deck.log
StandardError=append:${HOME}/.hermes/logs/agent-deck.log

[Install]
WantedBy=default.target
EOF
}

_write_launchd_plist() {
  # Write (or overwrite) the launchd plist for Agent Deck.
  local plist_path="$HOME/Library/LaunchAgents/io.agent-deck.app.plist"
  local node_bin pnpm_bin
  node_bin="$(_node_bin)"
  pnpm_bin="$(_pnpm_bin)"

  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.agent-deck.app</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_bin}</string>
    <string>${pnpm_bin}</string>
    <string>--filter</string>
    <string>@agent-deck/server</string>
    <string>exec</string>
    <string>tsx</string>
    <string>src/index.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${AGENT_DECK_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>AGENT_DECK_WEB_CLIENT_ROOT</key>
    <string>${AGENT_DECK_DIR}/apps/web/dist</string>
    <key>HERMES_GATEWAY_URL</key>
    <string>http://127.0.0.1:${HERMES_GATEWAY_PORT}</string>
    <key>HERMES_DASHBOARD_URL</key>
    <string>http://127.0.0.1:${HERMES_DASHBOARD_PORT}</string>
    <key>HERMES_DASHBOARD_HOST</key>
    <string>127.0.0.1:${HERMES_DASHBOARD_PORT}</string>
    <key>AGENT_DECK_PORT</key>
    <string>${AGENT_DECK_PORT}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.hermes/logs/agent-deck.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.hermes/logs/agent-deck.log</string>
</dict>
</plist>
EOF
  echo "$plist_path"
}

start_agent_deck() {
  log_step "[10/11] Starting Agent Deck..."
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$HOME/.hermes/logs"
  fi

  case "$OS" in
    linux)
      if _systemd_user_available; then
        # systemd user session available
        if [ "$DRY_RUN" -eq 1 ]; then
          log_dry "Would write $HOME/.config/systemd/user/agent-deck.service"
          log_dry "Would run: systemctl --user daemon-reload"
          log_dry "Would run: systemctl --user enable agent-deck.service"
          log_dry "Would run: systemctl --user restart agent-deck.service"
        else
          _write_systemd_unit
          systemctl --user daemon-reload
          systemctl --user enable agent-deck.service
          systemctl --user restart agent-deck.service
          log_success "Agent Deck started as a systemd user service"
          log_info "It will restart automatically if it crashes, and start again after login."
        fi
      else
        # No systemd user session: fall back to nohup background process
        if [ "$DRY_RUN" -eq 1 ]; then
          log_dry "No systemd user session available. Would start Agent Deck with nohup."
          log_dry "  AGENT_DECK_WEB_CLIENT_ROOT=... HERMES_GATEWAY_URL=... ... nohup pnpm ... &"
        else
          log_warn "systemd user session not available. Starting Agent Deck in the background."
          log_warn "It will not restart automatically if it stops. Re-run the installer to restart."
          AGENT_DECK_WEB_CLIENT_ROOT="$AGENT_DECK_DIR/apps/web/dist" \
          HERMES_GATEWAY_URL="http://127.0.0.1:$HERMES_GATEWAY_PORT" \
          HERMES_DASHBOARD_URL="http://127.0.0.1:$HERMES_DASHBOARD_PORT" \
          HERMES_DASHBOARD_HOST="127.0.0.1:$HERMES_DASHBOARD_PORT" \
          AGENT_DECK_PORT="$AGENT_DECK_PORT" \
          nohup pnpm --dir "$AGENT_DECK_DIR" --filter '@agent-deck/server' exec tsx src/index.ts \
            > "$HOME/.hermes/logs/agent-deck.log" 2>&1 &
          log_success "Agent Deck started in background (PID $!)"
        fi
      fi
      ;;
    macos)
      if [ "$DRY_RUN" -eq 1 ]; then
        log_dry "Would write ~/Library/LaunchAgents/io.agent-deck.app.plist"
        log_dry "Would run: launchctl unload <plist>  (silently, in case it was loaded)"
        log_dry "Would run: launchctl load ~/Library/LaunchAgents/io.agent-deck.app.plist"
        log_dry "Agent Deck will start automatically at login."
      else
        local plist_path
        plist_path="$(_write_launchd_plist)"
        launchctl unload "$plist_path" 2>/dev/null || true
        launchctl load "$plist_path"
        log_success "Agent Deck started as a launchd service"
        log_info "It will restart automatically if it crashes, and start again at login."
      fi
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Wait for Agent Deck to be ready, then open the browser
# ---------------------------------------------------------------------------
open_browser_to_agent_deck() {
  log_step "[11/11] Opening your browser..."
  local url="http://127.0.0.1:$AGENT_DECK_PORT"

  if [ "$DRY_RUN" -eq 1 ]; then
    log_dry "Would wait up to 30s for Agent Deck to respond at $url"
    log_dry "Would open $url in the default browser (open on macOS, xdg-open on Linux)."
    return 0
  fi

  # Wait up to 30s for Agent Deck to respond
  log_info "Waiting for Agent Deck to start (up to 30 seconds)..."
  local attempts=0
  while [ "$attempts" -lt 30 ]; do
    if curl -fsSo /dev/null --max-time 1 "$url/" 2>/dev/null; then
      break
    fi
    attempts=$((attempts + 1))
    printf "  ."
    sleep 1
  done
  printf "\n"

  if ! curl -fsSo /dev/null --max-time 1 "$url/" 2>/dev/null; then
    log_warn "Agent Deck did not respond within 30s."
    log_info "It may still be starting. Check the log:"
    log_info "  $HOME/.hermes/logs/agent-deck.log"
    log_info "Once it starts, open: $url"
    return 0
  fi

  log_success "Agent Deck is ready"

  case "$OS" in
    macos)
      open "$url" || true
      ;;
    linux)
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 || true
      else
        log_info "No browser launcher found. Open this URL manually:"
        log_info "  $url"
      fi
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Success banner
# ---------------------------------------------------------------------------
print_success_banner() {
  local url="http://127.0.0.1:$AGENT_DECK_PORT"

  printf "\n"
  printf "  +------------------------------------------------------------------+\n"
  printf "  |                                                                  |\n"
  printf "  |  %sAgent Deck is running%s                                          |\n" \
    "${_GREEN}" "${_RESET}"
  printf "  |                                                                  |\n"
  printf "  |  Bookmark this address in your browser:                         |\n"
  printf "  |                                                                  |\n"
  printf "  |    %s%s%s                                        |\n" \
    "${_BOLD}" "$url" "${_RESET}"
  printf "  |                                                                  |\n"
  printf "  |  The setup wizard will open automatically. Follow its steps     |\n"
  printf "  |  to connect a model provider and start chatting.                |\n"
  printf "  |                                                                  |\n"
  printf "  +------------------------------------------------------------------+\n"
  printf "\n"

  log_info "Logs:"
  log_info "  Agent Deck:       $HOME/.hermes/logs/agent-deck.log"
  log_info "  Hermes gateway:   $HOME/.hermes/logs/gateway-agent-deck.log"
  log_info "  Hermes dashboard: $HOME/.hermes/logs/dashboard-agent-deck.log"
  printf "\n"

  case "$OS" in
    linux)
      if _systemd_user_available; then
        local services="agent-deck.service"
        if [ "$GATEWAY_MANAGED" -eq 1 ]; then
          services="$services agent-deck-hermes-gateway.service"
        fi
        if [ "$DASHBOARD_MANAGED" -eq 1 ]; then
          services="$services agent-deck-hermes-dashboard.service"
        fi
        log_info "These run as systemd user services. They restart if they crash and"
        log_info "come back when you log in after a reboot:"
        log_info "  $services"
        log_info "To stop them:"
        log_info "  systemctl --user stop $services"
        log_info "To start them again:"
        log_info "  systemctl --user start $services"
      else
        log_info "No systemd user session, so everything runs as plain background"
        log_info "processes. After a reboot, re-run this installer to start them again."
      fi
      ;;
    macos)
      local plists="~/Library/LaunchAgents/io.agent-deck.app.plist"
      if [ "$GATEWAY_MANAGED" -eq 1 ]; then
        plists="$plists ~/Library/LaunchAgents/io.agent-deck.hermes-gateway.plist"
      fi
      if [ "$DASHBOARD_MANAGED" -eq 1 ]; then
        plists="$plists ~/Library/LaunchAgents/io.agent-deck.hermes-dashboard.plist"
      fi
      log_info "What this installer started runs as launchd services. They restart if"
      log_info "they crash and come back when you log in after a reboot."
      log_info "To stop them:"
      log_info "  launchctl unload $plists"
      log_info "To start them again:"
      log_info "  launchctl load $plists"
      ;;
  esac

  printf "\n"
  log_info "To update Agent Deck: re-run this installer at any time."
  printf "\n"
}

# ---------------------------------------------------------------------------
# Dry-run final summary
# ---------------------------------------------------------------------------
print_dry_run_summary() {
  printf "\n"
  printf "  +------------------------------------------------------------------+\n"
  printf "  |  %s[DRY-RUN] Plan complete%s -- nothing was installed or changed.       |\n" \
    "${_YELLOW}" "${_RESET}"
  printf "  +------------------------------------------------------------------+\n"
  printf "\n"
  log_info "To run the real install: bash install.sh"
  printf "\n"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  print_banner
  detect_os
  check_network
  check_git
  install_hermes
  check_node
  check_pnpm
  install_agent_deck
  check_ports
  start_hermes_gateway
  start_hermes_dashboard
  start_agent_deck
  open_browser_to_agent_deck

  if [ "$DRY_RUN" -eq 1 ]; then
    print_dry_run_summary
  else
    print_success_banner
  fi
}

main
