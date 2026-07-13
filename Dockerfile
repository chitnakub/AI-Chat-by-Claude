# Small, production-ish image for the Portkey chat UI.
FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev

# App source.
COPY server.js ./
COPY public ./public

EXPOSE 3000

# PORTKEY_API_KEY etc. are provided at runtime via --env-file / compose.
CMD ["node", "server.js"]
