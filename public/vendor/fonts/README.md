# Vendored web fonts

Self-hosted because the site's Content-Security-Policy is `default-src 'self'`,
which blocks Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`). Serving
them from this origin keeps the landing page's typography faithful to the design
without loosening the policy.

Both are variable fonts, `wght` axis only (the smallest build that still covers
every weight the design uses).

| File | Family | Weights used | Source |
|---|---|---|---|
| `bricolage-grotesque-wght.woff2` | Bricolage Grotesque | 600, 700, 800 | `@fontsource-variable/bricolage-grotesque` 1.x |
| `dm-sans-wght.woff2` | DM Sans | 400, 500, 600 | `@fontsource-variable/dm-sans` 5.3.0 |

## Licence

Both families are licensed under the **SIL Open Font License, Version 1.1** — see
`OFL.txt`.

- Bricolage Grotesque — Copyright The Bricolage Project Authors
  (https://github.com/ateliertriay/bricolage)
- DM Sans — Copyright 2014 The DM Sans Project Authors
  (https://github.com/googlefonts/dm-fonts)

`OFL.txt` in this directory carries the full licence text.
