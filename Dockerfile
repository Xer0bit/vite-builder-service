FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install build deps for building native modules (better-sqlite3)
RUN apk add --no-cache build-base python3 sqlite-dev

# Copy server package.json and install server dependencies
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy server code
COPY server ./server
# Use Corepack to prepare pnpm and yarn without global install collisions
# Corepack is included in Node 18 and can enable package managers
RUN corepack enable && \
	corepack prepare pnpm@8.5.0 --activate && \
	corepack prepare yarn@stable --activate

# Expose port
EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server/index.js"]
