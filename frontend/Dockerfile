FROM node:18-alpine

WORKDIR /app

# Install deps first for layer caching
COPY package*.json ./
RUN npm install

# App source
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
