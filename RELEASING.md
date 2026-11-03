# Releasing

Desktop builds for macOS, Windows and Linux are produced by
[`.github/workflows/release.yml`](.github/workflows/release.yml). Each platform
must be bundled on its own runner, so a full release goes through CI — a Mac
cannot produce Windows or Linux installers.

## One-time setup

1. Create the GitHub repository and push:

   ```bash
   gh repo create agent-ui-studio --public --source=. --remote=origin
   git push -u origin main
   ```

2. Nothing else is required. The workflow uses the built-in `GITHUB_TOKEN`;
   signing secrets are optional (see below).

## Cutting a release

Version numbers live in three files and must match:

| File | Field |
| --- | --- |
| `web/package.json` | `version` |
| `web/src-tauri/tauri.conf.json` | `version` |
| `web/src-tauri/Cargo.toml` | `version` |

`make version-check` compares those three. Two lockfiles record the version as
well and should be bumped in the same commit — `web/package-lock.json` (the
`version` at the top and inside `packages[""]`, not the unrelated dependency
that happens to share the number) and the `agentui-studio` entry in
`web/src-tauri/Cargo.lock`. Nothing fails loudly if you forget, but the
lockfiles then disagree with the tag.

Then:

```bash
make version-check          # fails if the three disagree
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds four targets across Windows, macOS (Apple Silicon & Intel), and Linux, runs the test suites on each, and automatically publishes the release with all installers attached.

| Platform | Artifacts |
| --- | --- |
| macOS (Apple Silicon) | `AgentUI.Studio_<version>_aarch64.dmg`, `AgentUI.Studio_aarch64.app.tar.gz` |
| macOS (Intel) | `AgentUI.Studio_<version>_x64.dmg`, `AgentUI.Studio_x64.app.tar.gz` |
| Windows | `AgentUI.Studio_<version>_x64-setup.exe` (NSIS) |
| Linux | `.AppImage`, `.deb` and `.rpm` |

The Windows job passes `--bundles nsis`, so the release carries the NSIS
installer only. A local `make desktop` on Windows bundles every target and does
also produce an `.msi`; that one is not published.

`workflow_dispatch` runs the same job against an existing tag if a build needs
repeating.

## Building locally

Only for the platform you are on:

```bash
make desktop                        # host architecture
make desktop-mac                    # both macOS architectures
```

Artifacts land in `web/src-tauri/target/<triple>/release/bundle/`.

## Code signing

The builds are **ad-hoc signed and not notarised**. The release workflow sets
`APPLE_SIGNING_IDENTITY` to `-` when no Developer ID secret is configured, which
is what makes macOS builds launchable at all: without any identity Tauri never
seals the `.app` bundle, the linker's own ad-hoc signature then advertises
sealed resources that do not exist, and macOS rejects the app as damaged rather
than merely unidentified. `v0.1.1` and earlier shipped in that state. A
`codesign --verify --deep --strict` gate now fails the macOS jobs if it happens
again.

Ad-hoc signing costs nothing and needs no account, but it is not notarisation,
so a first launch is still gated:

- **macOS** — "cannot be opened because the developer cannot be verified".
  Right-click the app and choose *Open*, or:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/AgentUI Studio.app"
  ```
- **Windows** — SmartScreen shows "Windows protected your PC". Choose
  *More info → Run anyway*.
- **Linux** — no warning; `.AppImage` needs `chmod +x`.

To remove the warnings you need developer identities, which cost money and are
tied to your identity:

- **Apple**: a Developer Program membership (99 USD/year) for a *Developer ID
  Application* certificate plus notarisation. Add the six repository secrets
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`, then forward the five the
  workflow does not pass yet, in the `Build and publish` step's `env`:

  ```yaml
  APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
  APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  ```

  They are left out until then on purpose: an unset secret expands to an empty
  string, and Tauri treats the variable as present rather than checking that it
  is non-empty, so forwarding them without certificates makes every macOS build
  fail trying to import a keychain certificate. `APPLE_SIGNING_IDENTITY` is
  already forwarded and displaces the ad-hoc `-` as soon as you set it.
- **Windows**: an OV or EV code-signing certificate from a CA. EV clears
  SmartScreen immediately; OV builds reputation over time.

Add the secrets yourself — they are credentials and should not be pasted into a
chat or a file in the repository.

## What ships inside the app

The Go daemon is bundled as a Tauri sidecar, so users install one thing. On
launch the app picks a free loopback port, generates a fresh API token, starts
the daemon, and shuts it down on exit. Nothing listens beyond `127.0.0.1`.
