FROM golang:1.26-bookworm@sha256:632dff7351799a5a9954a48dc06670ade72ee44e8c351cdc0e5a57af2fea21af AS smokescreen
WORKDIR /src
RUN git init && git remote add origin https://github.com/stripe/smokescreen.git && git fetch --depth 1 origin 68e7b8218e226bc47d09ce705fdb8fed82145ceb && git checkout --detach FETCH_HEAD
RUN CGO_ENABLED=0 go build -mod=vendor -trimpath -ldflags="-s -w" -o /out/smokescreen .

FROM node:26-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe AS build
RUN npm install --global pnpm@11.9.0
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/browser/package.json apps/browser/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/fixture/package.json apps/fixture/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec esbuild apps/browser/server.ts --bundle --platform=node --format=esm --external:playwright --outfile=/out/server.mjs
RUN pnpm --filter @oddhound/browser deploy --prod --legacy /runtime

FROM node:26-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe AS node-runtime
FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea
COPY --from=node-runtime /usr/local/ /usr/local/
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv nftables iproute2 libnss3-tools util-linux ca-certificates && python3 -m venv /opt/mitmproxy && /opt/mitmproxy/bin/pip install --no-cache-dir mitmproxy==12.3.1
RUN groupadd --gid 1101 browser && useradd --uid 1101 --gid 1101 --no-create-home browser && groupadd --gid 1102 gateway && useradd --uid 1102 --gid 1102 --no-create-home gateway && groupadd --gid 1103 smoke && useradd --uid 1103 --gid 1103 --no-create-home smoke
WORKDIR /opt/oddhound
COPY --from=build /runtime/node_modules/ ./node_modules/
COPY --from=build /out/server.mjs ./server.mjs
COPY --from=smokescreen /out/smokescreen ./smokescreen
COPY --from=smokescreen /src/LICENSE.txt ./licenses/smokescreen.txt
COPY apps/browser/gateway.py apps/browser/request_policy.py apps/browser/chromium-launcher.sh ./
COPY apps/browser/LICENSE.Playwright ./licenses/playwright.txt
RUN chmod 755 chromium-launcher.sh && ln -s "$(node -e 'process.stdout.write(require("playwright").chromium.executablePath())')" /opt/oddhound/chromium-real
ENV NODE_ENV=production
CMD ["node","/opt/oddhound/server.mjs"]
