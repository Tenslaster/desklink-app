# DeskLink (iOS client)

Expo React Native app for controlling a Windows PC on your local network.

- **Build:** GitHub Actions → unsigned IPA (install with Sideloadly / AltStore)
- **Host software is not in this repository** (runs only on your PC)

## Privacy

This repo is intended as a **temporary public** build mirror. Switch it to **private** when the IPA is done.

No host passwords, API keys, or backend code are stored here.

## Build IPA (GitHub Actions)

1. Actions → **iOS Build** → Run workflow  
2. Set `build_id` (e.g. `desklink-1.0.0`)  
3. Download the `ipa` artifact when green  

Or:

```bash
gh workflow run "iOS Build" -f build_id=desklink-1.0.0 -f configuration=Release
```

## Local (optional)

```bash
npm ci
npx expo start
```

## Bundle ID

`com.cedri.desklink`
