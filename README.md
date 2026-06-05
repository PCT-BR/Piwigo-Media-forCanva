# Piwigo Media for Canva

Canva app that connects Canva to a user-controlled Piwigo photo library through
the open-source Piwigo Canva Connector plugin.

This repository contains the Canva app only. The Piwigo connector plugin lives
in a separate repository:

https://github.com/PCT-BR/Canvaconnector-for-piwigo

## Architecture

Production flow:

```text
Canva app
  -> user's Piwigo instance
  -> plugins/canva_connector/api
```

The Canva app does not use a central backend to store Piwigo credentials. Users
install the connector plugin on their own Piwigo instance, authorize Canva from
Piwigo, copy a revocable connector token, and paste it into the Canva app.

## Development

Requirements:

- Node.js 22 or 24
- npm

Setup:

```bash
cp .env.template .env
npm install
npm run start
```

The local development URL is:

```text
http://localhost:8080
```

Configure this URL in the Canva Developer Portal while testing locally.

## Build

```bash
npm run build
```

The build also extracts UI strings to:

```text
dist/messages_en.json
```

Upload that file in the Canva Developer Portal translations section.

## Canva listing URLs

Use these URLs once GitHub Pages is enabled on the connector repository:

- Website: `https://pct-br.github.io/Canvaconnector-for-piwigo/`
- Terms: `https://pct-br.github.io/Canvaconnector-for-piwigo/terms-and-conditions.html`
- Privacy policy: `https://pct-br.github.io/Canvaconnector-for-piwigo/privacy-policy.html`
- Support: `https://pct-br.github.io/Canvaconnector-for-piwigo/support.html`

## Reviewer note

Piwigo is self-hosted software with user-controlled domains. To avoid routing
user media or Piwigo credentials through a central third-party service, this app
uses an open-source connector plugin installed on the user's own Piwigo
instance. The connector generates a local revocable token after the Piwigo
administrator reviews and accepts the requested access.
