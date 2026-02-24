FROM node:20-slim

# Install Chromium + WebGL system dependencies for Puppeteer headless rendering
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    fonts-noto-color-emoji \
    libgl1-mesa-dri \
    libgl1-mesa-glx \
    libegl1-mesa \
    libgbm1 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libasound2 \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Use system Chromium instead of Puppeteer's bundled download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Copy HTML template to dist (not handled by tsc)
RUN cp -r src/templates dist/templates

# Bundle Three.js locally — eliminates CDN dependency at runtime
RUN mkdir -p dist/templates/vendor/three/build && \
    mkdir -p dist/templates/vendor/three/examples/jsm && \
    cp node_modules/three/build/three.module.js dist/templates/vendor/three/build/ && \
    cp -r node_modules/three/examples/jsm/loaders dist/templates/vendor/three/examples/jsm/loaders && \
    cp -r node_modules/three/examples/jsm/libs dist/templates/vendor/three/examples/jsm/libs

EXPOSE 3002

CMD ["node", "dist/index.js"]
