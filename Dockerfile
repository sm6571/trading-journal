FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/trading_journal.db
ENV PORT=5000

EXPOSE 5000

CMD ["node", "app.js"]
