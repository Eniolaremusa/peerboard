FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.mjs ./
ENV PORT=3002
EXPOSE 3002
CMD ["node", "server.mjs"]
