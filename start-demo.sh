#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEMO_BACKEND_PORT=8000
DEMO_FRONTEND_PORT=5173
MCP_SERVER_PORT=3000
NEUCLEA_BACKEND_PORT=8080
NEUCLEA_FRONTEND_PORT=5174

# Store PIDs for cleanup
declare -a PIDS=()

# Function to print colored messages
print_status() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Function to cleanup all processes
cleanup() {
    print_status "Shutting down all services..."

    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            print_status "Killing process $pid"
            kill "$pid" 2>/dev/null
        fi
    done

    # Kill any remaining processes on ports
    print_status "Cleaning up ports..."
    fuser -k "$DEMO_BACKEND_PORT/tcp" 2>/dev/null
    fuser -k "$DEMO_FRONTEND_PORT/tcp" 2>/dev/null
    fuser -k "$MCP_SERVER_PORT/tcp" 2>/dev/null
    fuser -k "$NEUCLEA_BACKEND_PORT/tcp" 2>/dev/null
    fuser -k "$NEUCLEA_FRONTEND_PORT/tcp" 2>/dev/null

    print_success "All services stopped"
    exit 0
}

# Trap Ctrl+C and other termination signals
trap cleanup SIGINT SIGTERM EXIT

# Function to check if a command exists
check_command() {
    if ! command -v "$1" &> /dev/null; then
        print_error "$1 is not installed. Please install it first."
        exit 1
    fi
}

# Check required commands
print_status "Checking dependencies..."
check_command "uv"
check_command "pnpm"
check_command "go"
check_command "node"
print_success "All dependencies found"

# Start Demo Backend
print_status "Starting Demo Backend on port $DEMO_BACKEND_PORT..."
cd demo/backend || exit 1

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    print_warning "Virtual environment not found. Creating..."
    uv venv --python 3.11
fi

source .venv/bin/activate
uv run uvicorn main:app --reload --port "$DEMO_BACKEND_PORT" &
PIDS+=($!)
cd - > /dev/null || exit 1
print_success "Demo Backend started (PID: ${PIDS[-1]})"

# Wait for backend to be ready
print_status "Waiting for Demo Backend to be ready..."
sleep 3

# Start Demo Frontend
print_status "Starting Demo Frontend on port $DEMO_FRONTEND_PORT..."
cd demo/frontend || exit 1
pnpm install > /dev/null 2>&1
pnpm dev --port "$DEMO_FRONTEND_PORT" &
PIDS+=($!)
cd - > /dev/null || exit 1
print_success "Demo Frontend started (PID: ${PIDS[-1]})"

# Start MCP Server
print_status "Starting MCP Server on port $MCP_SERVER_PORT..."
cd demo/mcp-server || exit 1
pnpm install > /dev/null 2>&1
pnpm build > /dev/null 2>&1
MCP_BASE_URL="http://localhost:$DEMO_BACKEND_PORT" \
MCP_TRANSPORT=http \
PORT="$MCP_SERVER_PORT" \
node dist/index.js &
PIDS+=($!)
cd - > /dev/null || exit 1
print_success "MCP Server started (PID: ${PIDS[-1]})"

# Start Neuclea Backend
print_status "Starting Neuclea Backend on port $NEUCLEA_BACKEND_PORT..."
cd neuclea/backend || exit 1
go build -ldflags="-buildid=" -o neuclea main.go
PORT="$NEUCLEA_BACKEND_PORT" ./neuclea &
PIDS+=($!)
cd - > /dev/null || exit 1
print_success "Neuclea Backend started (PID: ${PIDS[-1]})"

# Wait for backend to be ready
print_status "Waiting for Neuclea Backend to be ready..."
sleep 2

# Start Neuclea Frontend
print_status "Starting Neuclea Frontend on port $NEUCLEA_FRONTEND_PORT..."
cd neuclea/frontend || exit 1
pnpm install > /dev/null 2>&1
pnpm dev --port "$NEUCLEA_FRONTEND_PORT" &
PIDS+=($!)
cd - > /dev/null || exit 1
print_success "Neuclea Frontend started (PID: ${PIDS[-1]})"

# Print summary
echo ""
print_success "All services started successfully!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Services running:${NC}"
echo "  • Demo Backend:      http://localhost:$DEMO_BACKEND_PORT"
echo "  • Demo Frontend:     http://localhost:$DEMO_FRONTEND_PORT"
echo "  • MCP Server:        http://localhost:$MCP_SERVER_PORT"
echo "  • Neuclea Backend:   http://localhost:$NEUCLEA_BACKEND_PORT"
echo "  • Neuclea Frontend:  http://localhost:$NEUCLEA_FRONTEND_PORT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
print_warning "Press Ctrl+C to stop all services"

# Wait for all background processes
wait
