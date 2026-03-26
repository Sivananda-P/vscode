FROM node:22-bullseye-slim

WORKDIR /app

# Install dependencies needed for native node modules and image processing
RUN apt-get update && apt-get install -y python3 make g++ libvips-dev && rm -rf /var/lib/apt/lists/*

# Increase the NPM fetch timeout to prevent the sharp installation from timing out
ENV npm_config_fetch_retry_maxtimeout=600000 \
    npm_config_fetch_retry_mintimeout=100000

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
