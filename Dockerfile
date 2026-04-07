FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

# Build the Vite React frontend (if any) and TS scripts just in case
RUN npm run build || true

# Generate a dist folder if it doesn't exist to prevent express from crashing on static serving
RUN mkdir -p dist/assets && [ -f dist/index.html ] || echo "<!DOCTYPE html><html><body>Campus Food Waste RL Optimizer API is running.</body></html>" > dist/index.html

EXPOSE 7860

# We use tsx directly to run the server in production to avoid needing a build step for the backend
CMD ["npx", "tsx", "server.ts"]
