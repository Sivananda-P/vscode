FROM node:22-bullseye

# Install dependencies required by VS Code
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    pkg-config \
    libsecret-1-dev \
    libx11-dev \
    libxkbfile-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Ensure we have git configured
RUN git config --global user.name "Docker User" && \
    git config --global user.email "docker@example.com"

# Copy all source code first (needed because package.json runs a preinstall script in build/npm/preinstall.ts)
COPY . .
RUN npm install --legacy-peer-deps

# We use yarn or npm. Since it uses npm here:
RUN npm run compile-web

# Expose the web server port
EXPOSE 8080

# Start the web server and accept all external connections automatically
CMD ["./scripts/code-server.sh", "--host", "0.0.0.0", "--port", "8080", "--without-connection-token"]
