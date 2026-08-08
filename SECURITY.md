# Security status (DeskLink iOS client)

## In this repository
- No host passwords, API keys, or backend code.
- App accepts host IP + password at runtime only (Secure Store on device).
- GitHub Actions builds unsigned IPAs (no Apple signing secrets required).

## Dependency hardening (Expo 52 compatible)
Safe overrides that do **not** break expo prebuild:
- postcss ^8.5.26
- cross-spawn, braces, micromatch, semver, ws, nanoid, cookie

## Residual risks (cannot force without breaking Expo 52)

| Package | Severity | Why not forced |
|---------|----------|----------------|
| tar 6.2.1 | high/critical | tar@7 breaks Expo template extract |
| @xmldom/xmldom | high | 0.9.x breaks Info.plist parse (mimeType) |
| image-size <=2.0.2 | high | No patched release; metro build-time only |
| uuid (old) | medium | uuid@11 can break RN tooling chains |

Proper long-term fix: upgrade Expo SDK when ready (53+).

## iOS build fix (not a vuln)
Xcode 26 + RN 0.76 fmt 11 consteval: CI patches Podfile (C++17 for fmt) + base.h rewrite.
