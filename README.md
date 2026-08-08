# Gogh Punks Website

Official public website for Gogh Punks, a collection of 10,000 fully on-chain pixel portraits on Robinhood Chain.

## Official links

- [OpenSea](https://opensea.io/collection/gogh-punks-255843210)
- [Discord](https://discord.gg/NgRzPNra6s)
- Contract: `0xE0F92B3B0E6DeD3654177FE3809Cd300e5ffaDf6`

## Validate

Requires Node.js 24.

```sh
npm run check
```

## Netlify

The repository is ready for direct import into Netlify. Its checked-in `netlify.toml` publishes the `site` directory, validates the public assets during builds, configures the `/verify/` route, and applies production security headers.

The always-on Discord Gateway bot is deployed separately from this static website.
