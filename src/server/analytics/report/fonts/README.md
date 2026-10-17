# Review report PDF fonts

Static TTFs used **only** by the server-side review-report PDF (`../fonts.ts`). They are read from
disk at render time. Nothing is downloaded at runtime, and the files are never served to browsers.
The web UI keeps using `next/font`.

| File                            | Family / weight      | Official source                                                                                                      |
| ------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `BarlowCondensed-SemiBold.ttf`  | Barlow Condensed 600 | `google/fonts` → `ofl/barlowcondensed/BarlowCondensed-SemiBold.ttf`                                                  |
| `BarlowCondensed-Bold.ttf`      | Barlow Condensed 700 | `google/fonts` → `ofl/barlowcondensed/BarlowCondensed-Bold.ttf`                                                      |
| `BarlowCondensed-ExtraBold.ttf` | Barlow Condensed 800 | `google/fonts` → `ofl/barlowcondensed/BarlowCondensed-ExtraBold.ttf`                                                 |
| `Barlow-Regular.ttf`            | Barlow 400           | `google/fonts` → `ofl/barlow/Barlow-Regular.ttf`                                                                     |
| `Barlow-SemiBold.ttf`           | Barlow 600           | `google/fonts` → `ofl/barlow/Barlow-SemiBold.ttf`                                                                    |
| `JetBrainsMono-Medium.ttf`      | JetBrains Mono 500   | `JetBrains/JetBrainsMono` → `fonts/ttf/JetBrainsMono-Medium.ttf` (static; google/fonts ships only the variable font) |

## Licenses

All the fonts use the SIL Open Font License 1.1. The license files are copied verbatim:

- `licenses/Barlow-OFL.txt`: `google/fonts` → `ofl/barlow/OFL.txt` ("Copyright 2017 The Barlow
  Project Authors"). The same project covers **Barlow** and **Barlow Condensed**. The file in
  `ofl/barlowcondensed/OFL.txt` is byte-identical, so it is kept once.
- `licenses/JetBrainsMono-OFL.txt`: `JetBrains/JetBrainsMono` → `OFL.txt` ("Copyright 2020 The
  JetBrains Mono Project Authors").

## Why not `next/font` output

The WOFF2 subsets that `next/font` emits into `.next/static/media` have hashed names that change
between builds. They also crash fontkit (react-pdf 4.9) when it subsets composed Spanish glyphs
(`Ó`, `Ñ`, `é`, `ú`) with `RangeError: Offset is outside the bounds of the DataView`.
`fonts.test.tsx` renders every family with `ÁÉÍÓÚÑÜ áéíóúñü`.

## SHA-256

```
95aa02c7c43096e0dd44d787ba6216864a67157e402adab59b35572e0c1577ea  Barlow-Regular.ttf
86577cb32f8abe3673db53ca0f4221e6856751a4f6730c867e00f720f8bb1fc5  Barlow-SemiBold.ttf
e476562ec9c1e16cf16475895b511f08c804f438cc9a9f80a44ea50a0eeb5b65  BarlowCondensed-Bold.ttf
724c9c25952d5f4a2d87185d9767aa006144c5f0d944dc05bf7d5d603551c260  BarlowCondensed-ExtraBold.ttf
7b619d14bc2327509a9ef32b0890f709626f7ecc9ff61191c2a4314c5499d2d9  BarlowCondensed-SemiBold.ttf
d16e6dc99672734698d629705f617c79f6eb6040f5113efe3a145204dc988109  JetBrainsMono-Medium.ttf
186d750eb496a4c17a76385f82be6aea2ac1cf2de074a811d63786cf374ea73f  licenses/Barlow-OFL.txt
a76abf002c49097d146e86740a3105a5d00450b1592e820a1109a8c5680cd697  licenses/JetBrainsMono-OFL.txt
```
