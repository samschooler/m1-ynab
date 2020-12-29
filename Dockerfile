FROM camilin87/node-cron:latest

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
