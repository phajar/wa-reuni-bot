FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Hugging Face Spaces port defaults to 7860
EXPOSE 7860

CMD ["npm", "start"]
