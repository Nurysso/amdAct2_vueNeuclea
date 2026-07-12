# neuclea/backend/Dockerfile
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Install git
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -v -ldflags="-buildid=" -o neuclea main.go

# Verify the binary exists
RUN ls -la /app/neuclea

# Final stage
FROM alpine:latest

WORKDIR /app

# Install ca-certificates
RUN apk --no-cache add ca-certificates

# Copy the binary from builder
COPY --from=builder /app/neuclea /app/neuclea

# Verify it was copied
RUN ls -la /app/neuclea

# Make it executable
RUN chmod +x /app/neuclea

# Expose the port
EXPOSE 8080

# Run the application
CMD ["/app/neuclea"]
