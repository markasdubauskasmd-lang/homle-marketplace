# Vendored web fonts

Self-hosted because the site's Content-Security-Policy is `default-src 'self'`,
which blocks Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`). Serving
them from this origin keeps typography faithful to the design without loosening
the policy.

| File | Family | Weights used | Source |
|---|---|---|---|
| `bricolage-grotesque-wght.woff2` | Bricolage Grotesque | 600, 700, 800 | `@fontsource-variable/bricolage-grotesque` 1.x |
| `dm-sans-wght.woff2` | DM Sans | 400, 500, 600 | `@fontsource-variable/dm-sans` 5.3.0 |
| `archivo-wght-{latin,latin-ext}.woff2` | Archivo | 800, 900 | Google Fonts CSS API v2, `archivo/v25` |
| `poppins-{400,500,600,700}-{latin,latin-ext}.woff2` | Poppins | 400, 500, 600, 700 | Google Fonts CSS API v2, `poppins/v24` |

The first two are variable (`wght` axis) and cover every subset in one file.

**Archivo** is also variable (`wght` 100-900) but the Google API serves it split by
unicode subset, so there is one file per subset.

**Poppins is not available as a variable font.** Asking the API for a range
(`wght@400..700`) returns HTTP 400; only discrete weights exist. Each weight is
therefore its own file, and `homle-cleaner.css` declares a single `font-weight`
per `@font-face` rather than a range — a range would leave the browser
synthesising the missing weights as faux bold.

Only `latin` and `latin-ext` are vendored. `latin-ext` is needed because Cleaner
and Landlord names routinely carry Polish, Lithuanian and Romanian diacritics.
`vietnamese` is deliberately omitted.

Characters such as ★ ✓ ↗ → ← ▾ sit outside every published subset for these
families and fall back to the reader's system font. Google's own hosted CSS
behaves the same way, so this matches the source design.

## Licence

All four families are licensed under the **SIL Open Font License, Version 1.1** —
see `OFL.txt` for the full text.

- Bricolage Grotesque — Copyright The Bricolage Project Authors
  (https://github.com/ateliertriay/bricolage)
- DM Sans — Copyright 2014 The DM Sans Project Authors
  (https://github.com/googlefonts/dm-fonts)
- Archivo — Copyright 2020 The Archivo Project Authors
  (https://github.com/Omnibus-Type/Archivo)
- Poppins — Copyright 2020 The Poppins Project Authors
  (https://github.com/itfoundry/Poppins)

Neither Archivo nor Poppins declares a Reserved Font Name, so the renamed files
above are permitted under the licence.