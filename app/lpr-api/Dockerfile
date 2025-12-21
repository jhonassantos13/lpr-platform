# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app

# node_modules DO RUNTIME
COPY --from=deps /app/node_modules ./node_modules

# código fonte
COPY . .

# Gera Prisma Client NO node_modules QUE VAI PARA O RUNTIME
RUN npx prisma generate

# Build NestJS
RUN npm run build

# sanity check
RUN test -f /app/dist/src/main.js

# ---------- runner ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copia node_modules JÁ COM PRISMA GERADO
COPY --from=build /app/node_modules ./node_modules

# Copia dist
COPY --from=build /app/dist ./dist

# package.json só pra metadata
COPY package*.json ./

EXPOSE 3000
COPY prisma ./prisma
CMD ["node", "dist/src/main.js"]

