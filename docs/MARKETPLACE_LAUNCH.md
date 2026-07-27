# Historical Marketplace Launch Campaign

This file is retained as historical `v2.5.0` marketplace launch copy. Do not
use it as the current release source of truth. Use
[CURRENT_RELEASE.md](./CURRENT_RELEASE.md).

Use these posts after `2.5.0` is published and npm latest verifies. Keep every link pointed at npm until `https://www.memoire.cv/components` is deployed and healthy.

Primary link: `https://www.npmjs.com/package/@memi-design/cli`

## Master Marketplace Post

```text
memi 2.5.0 ships the distribution-proof shadcn registry marketplace.

Install registries for:
- SaaS app shells
- docs/blog UI
- dashboards
- landing pages
- auth flows
- AI chat
- ecommerce
- tweakcn-inspired themes

npm i -g @memi-design/cli
memi registry list

https://www.npmjs.com/package/@memi-design/cli
```

## Landing Page

```text
New Memoire registry: landing-page

Install a tokenized shadcn hero section into an app:

memi add HeroSection --from landing-page

No Figma required. It ships tokens, specs, React code, screenshot proof, and source metadata.

https://www.npmjs.com/package/@memi-design/cli
```

## Auth Flow

```text
New Memoire registry: auth-flow

Install login/signup/settings UI into a shadcn app:

memi add AuthCard --from auth-flow

Useful when your product works but the auth surface still feels generic.

https://www.npmjs.com/package/@memi-design/cli
```

## AI Chat

```text
New Memoire registry: ai-chat

For AI apps after the first prompt-generated pass:

memi add ChatComposer --from ai-chat
memi add ChatMessage --from ai-chat

Claude/v0 help create. Memoire helps package, validate, and reuse.

https://www.npmjs.com/package/@memi-design/cli
```

## Ecommerce

```text
New Memoire registry: ecommerce

Install product-card patterns for storefronts, pricing pages, and conversion surfaces:

memi add ProductCard --from ecommerce

Tokens, specs, React code, and registry metadata included.

https://www.npmjs.com/package/@memi-design/cli
```

## shadcn Community

```text
If shadcn made components installable, Memoire makes design systems installable.

Try a registry:
memi registry list
memi add HeroSection --from landing-page
memi add ChatComposer --from ai-chat

Everything is tokenized and published through registry.json.

https://www.npmjs.com/package/@memi-design/cli
```

## tweakcn Community

```text
tweakcn is where you shape a shadcn theme.
Memoire is how you package and distribute it.

Try the built-in tweakcn-inspired registries:
memi registry search tweakcn
memi add Button --from tweakcn-vercel

https://www.npmjs.com/package/@memi-design/cli
```

## Developer Forums

```text
Memoire now has a registry discovery flow:

memi registry list
memi registry search chat
memi registry info ai-chat
memi registry doctor ai-chat --json

It is a CLI for turning shadcn/Tailwind design systems into installable npm-backed registries.

https://www.npmjs.com/package/@memi-design/cli
```

## Reply Bank

```text
The difference from v0/Claude Design: Memoire is not first-pass generation. It is the cleanup, token extraction, registry packaging, and reuse layer after an app exists.
```

```text
The registry catalog is repo-owned and machine-readable: examples/marketplace-catalog.v1.json. The website can mirror it directly.
```

```text
Alias installs are supported for featured registries: `memi add ChatComposer --from ai-chat`.
```
