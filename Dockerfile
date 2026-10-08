FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
# Koyeb injects $PORT; the app reads it already.
EXPOSE 3000
CMD ["npm", "start"]
