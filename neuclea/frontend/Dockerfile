# neuclea/frontend/Dockerfile
FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 5174

# Run the application
CMD ["pnpm", "dev", "--host", "0.0.0.0"]
