FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install --omit=dev --workspaces --include-workspace-root || npm install --omit=dev
COPY . .
RUN npm install --no-save vite @vitejs/plugin-react react react-dom react-router-dom && npm run build -w web
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["node", "server/src/index.js"]
