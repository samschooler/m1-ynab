FROM samschooler/node-cron:11

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install

COPY . .
