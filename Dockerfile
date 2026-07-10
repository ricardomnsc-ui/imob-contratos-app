FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=4173
ENV DATA_DIR=/app/data
ENV UPLOAD_DIR=/app/uploads

# data/ e uploads/ devem ser montados como volume persistente na plataforma
# de hospedagem (ex.: Railway Volumes) — sem isso, contas e logos somem a
# cada novo deploy. A instrução VOLUME nativa do Docker não é usada aqui
# porque o Railway não a suporta; o volume é anexado pelo painel deles.
EXPOSE 4173
CMD ["node", "server.js"]
