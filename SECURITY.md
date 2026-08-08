# Security status (DeskLink iOS client)

## In this repository

- **No host passwords, API keys, or backend code.**
- App accepts host IP + password at runtime only (Secure Store on device).
- GitHub Actions builds **unsigned** IPAs (no Apple signing secrets required).

## Dependency hardening

`package.json` `overrides` force patched transitive packages used by Expo / Metro / tooling:

| Package | Override target | Notes |
|---------|-----------------|--------|
| tar | ^7.5.2 | Path traversal / DoS advisories |
| postcss | ^8.5.26 | Source-map path issues |
| uuid | ^11.1.0 | Buffer bounds check |
| @xmldom/xmldom | ^0.9.8 | XML serialization DoS / injection |
| image-size | ^2.0.2 | Latest published; see residual risk |
| glob, braces, micromatch, semver, ws, send, cookie, nanoid, cross-spawn | current safe floors | Common transitive noise |

## Residual risk (accepted for IPA build)

### `image-size` (HIGH — no patched release yet)

- Advisories: [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)
- Affected: `<= 2.0.2` — **Patched versions: none** (as of 2026-08-08)
- We pin **latest** (`2.0.2`) via override
- Impact path: **Metro / RN CLI at build or dev time** (malicious image assets), not a network attack surface on the installed IPA for DeskLink remote control
- npm’s suggested “fix” (`react-native@0.72.17`) is a **false / breaking** downgrade and must not be applied

Re-check after upstream ships a patch:

```bash
npm view image-size version
npm audit
```


### 	ar 6.2.1 (HIGH/CRITICAL — Expo 52 lock)

- Expo SDK 52 / @expo/cli still depends on 	ar@6.2.1 for template extract.
- Forcing 	ar@7 breaks expo prebuild with: Cannot read properties of undefined (reading '\''extract'\'').
- Proper fix: upgrade Expo major (SDK 53+) when ready; **not** forced override on SDK 52.
- Risk is build-tooling / malicious tar archives during install/prebuild, not the signed phone session protocol.

## iOS build fix (not a vuln)

Xcode 26 + RN 0.76 ships `fmt` 11 which fails `consteval` checks. CI patches Podfile (`CLANG_CXX_LANGUAGE_STANDARD=c++17` for `fmt`) and rewrites `FMT_USE_CONSTEVAL` as belt-and-suspenders.
