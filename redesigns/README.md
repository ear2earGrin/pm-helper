# /redesigns — hosted redesign artifacts

Each website redesign the routine produces lives here as a self-contained
folder and is served by GitHub Pages:

```
redesigns/<company-slug>/index.html   →   https://pm-brief.com/redesigns/<company-slug>/
```

Rules:
- **One folder per company**, slug = lowercase company name, spaces → `-`
  (e.g. `sunrise-bakery`). Keep it stable so the link doesn't change.
- Everything **self-contained** — inline CSS/JS, and images either inlined as
  `data:` URIs or placed inside the same folder. No build step.
- After committing a redesign, write its public URL into
  `pmh_jobs.redesign_url` for that company (see `docs/REDESIGN-ROUTINE.md`).

`.nojekyll` is present at the repo root, so underscore-prefixed folders like
`_example/` are served correctly.
