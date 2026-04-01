FROM node:20-alpine

RUN apk add --no-cache postgresql16-client

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm install
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src

# NOTE: `RUN npx tsc --noEmit` is not enabled yet because there are
# pre-existing type errors in code-project.service.ts, gallery.service.ts,
# and workbench-examples.service.ts. Once those are fixed, uncomment:
# RUN npx tsc --noEmit

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/scripts/run-data-migrations.ts && npm run dev"]
