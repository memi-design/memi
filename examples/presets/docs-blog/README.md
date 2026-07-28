# @memoire-examples/docs-blog

<p align="center">
  <img src="../../../assets/showcases/docs-blog.svg" alt="Docs Blog preview" width="720" />
</p>

An editorial docs/blog starter built for long-form reading, product docs, changelogs, and content sites. Soft surfaces, calm contrast, and a clear accent for navigation and callouts.

```
--color-primary:    oklch(60% 0.18 280)   /* indigo-violet */
--color-background: oklch(99% 0.005 280)  /* warm near-white */
```

## Install

```bash
memi add Button --from @memoire-examples/docs-blog
```

## Fork and ship your own

```bash
cp -r examples/presets/docs-blog my-ds && cd my-ds
# rename in package.json + registry.json
memi publish --name @yourscope/your-ds
npm publish --access public
```

Source: [examples/presets/docs-blog](https://github.com/memi-design/memi/tree/main/examples/presets/docs-blog)
