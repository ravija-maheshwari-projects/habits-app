FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY public ./public
COPY src ./src

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
