#!/bin/bash
# Setup script for novamart-api observability stack

echo "🚀 Setting up Observability Stack for novamart-api"

# Check if docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose is not installed. Please install it first."
    exit 1
fi

# Start the stack
echo "📊 Starting observability stack..."
docker-compose -f docker-compose.telemetry.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check services
echo -e "
✅ Services status:"
docker-compose -f docker-compose.telemetry.yml ps

# Print access information
echo -e "
📊 Access your dashboards:"
echo "   Grafana: http://localhost:3001 (admin/admin)"
echo "   Prometheus: http://localhost:9091"
echo "   Loki: http://localhost:3100"

echo -e "
🔧 To start your MCP server with telemetry:"
echo "   source .env"
echo "   node dist/index.js"

echo -e "
📝 To view logs:"
echo "   docker-compose -f docker-compose.telemetry.yml logs -f"

echo -e "
🛑 To stop the stack:"
echo "   docker-compose -f docker-compose.telemetry.yml down"
