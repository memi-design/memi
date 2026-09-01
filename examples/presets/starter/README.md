# @memoire-examples/starter

A neutral, grayscale Memoire Registry with a single blue accent — the hello-world for Memoire.

**Palette:** neutral grays + `oklch(55% 0.15 250)` blue accent
**Font:** system-ui stack
**Components:** Button, Card, Badge, Input (all atoms/molecules)

## Fork and ship your own

```bash
# 1. Copy this preset
cp -r examples/presets/starter my-design-system
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

Generated for Memoire v2.8.0-beta.1.
