# Nexarag — documentation & landing site

A static site: hand-written HTML, CSS and JavaScript with **no build step, no
dependencies and no external requests**. It works opened straight from disk, and
it works on GitHub Pages without a toolchain to keep alive.

```
.
├── index.html                       # the whole page
├── assets/css/styles.css            # design tokens, layout, components
├── assets/js/site.js                # theme, nav, scroll-spy, copy, highlighting
├── .nojekyll                        # stop Pages running the content through Jekyll
└── .github/workflows/deploy-pages.yml
```

## Preview locally

Any static server works. Two that need nothing installed:

```bash
python3 -m http.server 8080     # then open http://localhost:8080
npx serve .
```

Opening `index.html` directly with `file://` also works — the only degradation is
the copy-to-clipboard button, which needs a secure context and falls back to
telling you to press Ctrl+C.

## Deploy to GitHub Pages

1. Push this directory as the root of a **public** repository.
2. **Settings → Pages → Build and deployment → Source → GitHub Actions.**
3. Push to `main`, or press **Re-run jobs** on the failed first run. The included
   workflow uploads the directory and deploys it; the live URL then appears at
   the top of Settings → Pages.

Step 2 has to be done by hand, once. The workflow cannot do it for you:
`actions/configure-pages` accepts an `enablement: true` input that looks like it
would, but creating a Pages site requires repository-admin credentials and the
automatic `GITHUB_TOKEN` is not one — it fails with `Create Pages site failed.
Error: Resource not accessible by integration`.

Before step 2, every run fails at Configure Pages with `Get Pages site failed.
Error: Not Found`. That is the expected symptom, not a broken workflow.

Hosting is free: Pages and Actions minutes both cost nothing on public
repositories. A private repository would need a paid plan to publish.

### Serving from a subdirectory instead

If you would rather keep the site inside an existing repo under `docs/`, move the
files there and change one line in `.github/workflows/deploy-pages.yml`:

```yaml
path: './docs'
```

Or skip Actions entirely: **Settings → Pages → Source → Deploy from a branch →
`main` / `/docs`**. The site is plain static files, so it needs no build either way.

### Project pages and relative paths

Every asset reference is relative (`assets/css/styles.css`, not `/assets/...`), so
the site works unchanged at a user page (`org.github.io`) *and* at a project page
(`org.github.io/Nexarag-site/`). Keep it that way — a leading slash breaks project
pages and the failure only shows up after deploy.

## Editing

- **Colours, spacing, radius, shadows** — the token block at the top of
  `styles.css`. Dark values are defined twice on purpose: once under
  `prefers-color-scheme` for people who never touch the toggle, once under
  `[data-theme="dark"]` so the toggle wins in both directions. Never define a
  colour *only* inside a media query.
- **Syntax highlighting** — the `GRAMMARS` object in `site.js`. Languages
  included: `bash`, `yaml`, `json`, `python`, `typescript`, `cypher`. To add one,
  add an entry; rules are ordered and every group must be non-capturing.
- **A new code block** — wrap it as:

  ```html
  <div class="code-block">
    <div class="code-block__head"><span class="code-block__lang">bash</span></div>
    <pre><code data-lang="bash" data-copy-label="what this copies">...</code></pre>
  </div>
  ```

  The copy button is injected by JS; the block renders fine without it.
- **A new section** — add the `<section>` and a matching entry in the sidebar
  `.toc`. Scroll-spy picks it up automatically from the `href`.
