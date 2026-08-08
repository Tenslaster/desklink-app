# Security status (DeskLink iOS client)

## In this repository

- No host passwords, API keys, or backend code.
- App accepts host IP + password at runtime only (Secure Store on device).
- GitHub Actions builds unsigned IPAs (no Apple signing secrets required).

## Current stack

- **Expo SDK 57** (`expo@~57.0.11`)
- React Native 0.81.x / React 19
- `npm audit`: **0 vulnerabilities** (verified after lock refresh)

## How vulns were fixed

| Package | Issue | Fix |
|---------|--------|-----|
| tar | path traversal / DoS in 6.x | Expo 57 + override `tar@7.5.22` |
| uuid | buffer bounds | override `uuid@11.1.1` |
| @xmldom/xmldom | XML DoS / injection | override `@xmldom/xmldom@0.9.10` |
| image-size | ICNS/HEIF/JXL infinite loops (upstream archived, no official patch) | local package `vendor/image-size-patched` (2.0.3-desklink.1) with DoS guards |
| postcss, braces, micromatch, semver, ws, nanoid, cookie, glob, rimraf | common transitive | npm `overrides` floors |

## iOS CI note

Xcode 26 + RN `fmt` still gets a Podfile patch (`scripts/patch_podfile_fmt.py`) for consteval.

## Re-check

```bash
npm ci
npm audit
```
