FROM node:20-slim

# LibreOffice headless é usado para converter o .docx gerado em PDF sob
# demanda (ver lib/pdf.js). --no-install-recommends mantém a imagem menor.
RUN apt-get update && \
    apt-get install -y --no-install-recommends libreoffice-writer && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=4173
ENV DATA_DIR=/app/data

# /app/data deve ser montado como volume persistente na plataforma de
# hospedagem (ex.: Railway Volumes) — sem isso, contas, senhas e logos
# somem a cada novo deploy. Uploads ficam dentro de DATA_DIR por padrão
# (ver server.js), então um único volume cobre tudo. A instrução VOLUME
# nativa do Docker não é usada aqui porque o Railway não a suporta; o
# volume é anexado pelo painel deles.
EXPOSE 4173
CMD ["node", "server.js"]
