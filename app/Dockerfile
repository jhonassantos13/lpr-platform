FROM node:20-alpine

WORKDIR /app

# deps
COPY package*.json ./
RUN npm ci

# source
COPY . .

# build
RUN npm run build

EXPOSE 3000
CMD ["npm","run","start:prod"]
