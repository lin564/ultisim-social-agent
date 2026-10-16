FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DB_PATH=/data/social-agent.db
VOLUME /data
EXPOSE 8787
CMD ["npm", "start"]
