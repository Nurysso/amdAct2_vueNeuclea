#!/bin/bash

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "Stopping all services..."

# Kill processes by port
for port in 8000 5173 3000 8080 5174; do
    if lsof -i :"$port" > /dev/null 2>&1; then
        echo "Killing process on port $port"
        fuser -k "$port/tcp" 2>/dev/null
    fi
done

# Kill any remaining node/python/go processes
pkill -f "uvicorn.*main:app" 2>/dev/null
pkill -f "pnpm dev" 2>/dev/null
pkill -f "node dist/index.js" 2>/dev/null
pkill -f "./neuclea" 2>/dev/null

echo -e "${GREEN}All services stopped${NC}"
