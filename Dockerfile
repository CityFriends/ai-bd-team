# Node.js 20 runtime
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Prune dev dependencies for smaller image
RUN npm prune --production

# Start the application
CMD ["npm", "run", "start:prod"]
