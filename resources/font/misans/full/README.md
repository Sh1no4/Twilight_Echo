# Full MiSans faces (packaged)

Complete MiSans `.woff2` files ship with the app under
`/font/misans/full/` (via `misans-full.css` + `MiSans Full` family).

| File | Weight |
|---|---|
| `MiSans-Regular.woff2` | 300–450 |
| `MiSans-Medium.woff2` | 451–599 |
| `MiSans-Bold.woff2` | 600–750 |
| `MiSans-Heavy.woff2` | 751–900 |

Large binary faces may stay gitignored locally; packaging still copies whatever
exists under `resources/font/misans/full/` into the renderer public dir.
Subset faces in `../` remain the network-friendly fallback when full faces are absent.
