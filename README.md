# Vibe Sampler

Electron sampler with recording, MIDI mapping, sample packs, and a step sequencer.

## Development

```sh
npm ci
npm run dev
```

On first launch, the app offers to download the public starter packs from the
`vibe-sampler-samples` Google Cloud Storage bucket. Declining leaves the sampler empty so only local recordings and user-created packs are used. The decision is stored in Electron's user-data directory.

## macOS release

The `Release macOS DMG` GitHub Actions workflow builds a signed, hardened, notarized universal DMG. It can be run manually or by pushing a `v*` tag; tag builds also create a GitHub Release. Signing values are read at runtime from Google Secret Manager through short-lived GitHub OIDC credentials—there is no Google service-account key or Apple credential in GitHub.

Infrastructure and signing-secret setup are documented in the private `pavelzag/vibe-sampler-infra` repository.
