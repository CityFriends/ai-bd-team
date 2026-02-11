# Node.js 20 runtime
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
# --legacy-peer-deps needed for ESLint peer dependency conflicts
RUN npm ci --legacy-peer-deps

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Prune dev dependencies for smaller image
RUN npm prune --omit=dev --legacy-peer-deps

# Start the application
CMD ["npm", "run", "start:prod"]
