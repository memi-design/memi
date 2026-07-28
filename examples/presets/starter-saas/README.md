# @memoire-examples/starter-saas

<p align="center">
  <img src="../../../assets/showcases/starter-saas.svg" alt="Starter SaaS preview" width="720" />
</p>

A neutral SaaS starter for Memoire. Clean app-shell surfaces, one sharp product blue, and the core installable primitives most teams need first.

**Palette:** neutral grays + `oklch(55% 0.15 250)` blue accent  
**Vibe:** calm B2B SaaS  
**Components:** Button, Card, Badge, Input

## Install

```bash
memi add Button --from @memoire-examples/starter-saas
```

## Fork and ship your own

```bash
# 1. Copy this preset
cp -r examples/presets/starter-saas my-design-system
cd my-design-system

# 2. Rename in package.json + registry.json to @yourscope/your-ds

# 3. Publish
memi publish --name @yourscope/your-ds
npm publish --access public

# 4. Use it anywhere
memi add Button --from @yourscope/your-ds
```

## What you get

- Tailwind v4 `@theme` tokens (`tokens/tokens.css`)
- W3C DTCG token manifest (`tokens/tokens.json`)
- Four real React components using CSS variables, not hardcoded hex
- `Button.loading` prop that swaps the label for a spinner

Source: [examples/presets/starter-saas](https://github.com/memi-design/memi/tree/main/examples/presets/starter-saas)

Generated for Memoire v0.16.3.
