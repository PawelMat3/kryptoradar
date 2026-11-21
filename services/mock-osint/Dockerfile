FROM node:22-alpine
WORKDIR /app
COPY server.mjs pages.mjs ./
USER node
# Port 80 bez roota: docker-compose ustawia sysctl net.ipv4.ip_unprivileged_port_start=0
ENV PORT=80
EXPOSE 80
CMD ["node", "server.mjs"]
