# Nexarag — documentation & landing site

A static site: hand-written HTML, CSS and JavaScript with **no build step, no
dependencies and no external requests**. It works opened straight from disk, and
it works on GitHub Pages without a toolchain to keep alive.

```
.
├── index.html                       # the whole page
├── assets/css/styles.css            # tokens, layout, components, motion
├── assets/js/site.js                # theme, nav, scroll-spy, copy, highlighting
├── assets/js/lens.js                # the two scroll-driven set pieces + counters
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

## Motion

Three layers, in increasing order of how much they cost to run.

1. **Scrubbed section motion — CSS only.** Cards, modes, list items, stack items,
   headings, the reading progress bar and the reading sweep in *Why it exists* are
   driven by native scroll-driven animations (`animation-timeline: view()` and
   `scroll()`) in the last block of `styles.css`. There is no scroll listener
   behind any of it, and it is evaluated off the main thread — which is why a
   fling costs the same as a creep. Gated on `@supports (animation-timeline: view())`
   **and** `prefers-reduced-motion: no-preference`, so reduced motion needs no
   overrides: the animations are simply never declared and the resting CSS is the
   finished state.
2. **IntersectionObserver reveals — the fallback.** `initReveal` in `site.js` and
   the `.reveal*` classes still exist for browsers without scroll timelines
   (roughly one in six). Anything with a scrubbed treatment also has one of these,
   never only the scrubbed one.
3. **The two set pieces — JS.** `lens.js` owns the retrieval scene and the
   architecture diagram: one scroll listener, one rAF, split into a read pass and
   a write pass for both scenes together. Each writes a single custom property per
   frame and derives everything else from it in CSS.

Rules worth keeping:

- Keyframes here animate `translate` / `scale` / `opacity`, **never `transform`**.
  Hover lifts on cards, stack items and compare cards own `transform`, and an
  animation with `fill: both` outranks a normal declaration permanently — animating
  `transform` in a scroll animation silently kills every hover on the element.
- Small subjects are ranged in `cover` percentages, not `entry`: the `entry` range
  of a 2px rule is 2px of scroll, which completes in a single frame.
- Never scale a blurred surface in an animation. Moving the hero orbs with
  `translate` is compositor work; scaling them re-rasterizes a `blur(70px)` layer
  every frame, which was the only thing on this page dropping frames.
- Both set pieces decide by **measurement** whether to pin themselves, and fall
  back to a complete still telling when they would not fit. Pinning something the
  reader has to scroll inside explains nothing.

## Colour

Colour is **generated, not chosen**. `scripts/generate-palette.mjs` owns every colour value in
`assets/css/styles.css`, writing them between the `PALETTE-BLOCKS` markers — do not hand-edit
that region.

```bash
node scripts/generate-palette.mjs                    # list configurations
node scripts/generate-palette.mjs sextant            # write one into styles.css
node scripts/generate-palette.mjs sextant --verify    # print every enforced ratio, write nothing
```

A configuration contains **no hex**: only OKLCH hue angles and chroma targets, which are the
part that is a design decision. Everything else is derived, and every derived value is walked
along its lightness axis until it measurably meets its obligation.

### Why it works this way

The stylesheet used to have 22 WCAG AA text failures, and they were not a hue problem. One
token — `--text-faint` — was placed on three different surfaces and failed at three different
ratios (3.03, 3.22, 3.33), because nothing had decided what job that token had. A prettier
palette with the same role assignment reproduces every failure in new colours.

So each scale is twelve steps with a fixed job, following Radix Colors' step semantics
(1-2 backgrounds · 3-5 component backgrounds · 6-8 borders · 9-10 solid fills · 11 accessible
low-contrast text · 12 high-contrast text). The values are generated rather than taken from
Radix because Radix targets APCA, which disagrees with WCAG 2.x at the edges; the gate here is
stated in WCAG terms, so the WCAG number is the one computed.

Three rules in the generator are load-bearing:

- **Text is verified against every surface it can land on** — steps 1-4 *and* the section
  washes — not just against the page background. That single change is what fixed the original
  22 failures.
- **Three accessible text levels, all of which pass.** A 12-step scale affords two (11 and 12);
  this page's information design needs three, so the third is generated *inward* at AAA 7:1
  rather than by going lighter than step 11. Going lighter is the bug this replaces.
- **Separation for colour-blind readers is solved in simulated space, not authored space.**
  Dichromat simulation changes lightness — green loses it, purple gains it — so two colours set
  0.15 apart in lightness can cross over and land on top of one another. The syntax tokens and
  the brand-hue biases are both solved against Viénot/Brettel/Mollon simulations of
  deuteranopia and protanopia. Two syntax tokens additionally carry a non-colour channel
  (comment is italic, keyword is bold), because seven hues genuinely cannot be told apart on
  one surface and a syntax highlighter cannot add labels.

The favicon is the one colour that cannot be a token — a `data:` URI has no stylesheet to
resolve custom properties against — so the generator prints the three values to sync whenever
the palette changes.
