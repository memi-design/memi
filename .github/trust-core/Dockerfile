FROM node:20-bookworm-slim

ARG MEMI_TARBALL
COPY ${MEMI_TARBALL} /opt/memi.tgz
COPY scripts/trust-core-e2e.mjs /opt/trust-core-e2e.mjs
COPY scripts/lib/trust-core-e2e.mjs /opt/lib/trust-core-e2e.mjs

RUN mkdir -p /opt/consumer \
  && printf '{"name":"memi-trust-container","private":true}\n' > /opt/consumer/package.json \
  && npm install --prefix /opt/consumer --ignore-scripts --no-audit --no-fund --save-exact /opt/memi.tgz \
  && npm cache clean --force \
  && chmod -R a-w /opt/consumer /opt/trust-core-e2e.mjs /opt/lib/trust-core-e2e.mjs

USER 65532:65532
WORKDIR /tmp
ENV HOME=/tmp/home \
    MEMI_TELEMETRY_DISABLED=1 \
    npm_config_update_notifier=false

ENTRYPOINT ["node", "/opt/trust-core-e2e.mjs", "--container", "--installed-binary", "/opt/consumer/node_modules/@memi-design/cli/dist/index.js"]
