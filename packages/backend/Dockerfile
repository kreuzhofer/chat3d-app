FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm install
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/scripts/run-data-migrations.ts && npm run dev"]
