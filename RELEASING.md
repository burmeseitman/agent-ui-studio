# Releasing

Desktop builds for macOS, Windows and Linux are produced by
[`.github/workflows/release.yml`](.github/workflows/release.yml). Each platform
must be bundled on its own runner, so a full release goes through CI — a Mac
cannot produce Windows or Linux installers.

## One-time setup

1. Create the GitHub repository and push:

   ```bash
   gh repo create agent-ui-studio --private --source=. --remote=origin
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

Then:

```bash
make version-check          # fails if the three disagree
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds four targets across Windows, macOS (Apple Silicon & Intel), and Linux, runs the test suites on each, and automatically publishes the release with all installers attached.

| Platform | Artifacts |
| --- | --- |
| macOS (Apple Silicon) | `AgentUI Studio_<version>_aarch64.dmg` |
| macOS (Intel) | `AgentUI Studio_<version>_x64.dmg` |
| Windows | `.msi` and an NSIS `.exe` |
| Linux | `.AppImage` and `.deb` |

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

The builds are **unsigned**, which is fine for personal use and for sharing with
people you can talk to, but it is visible to anyone who downloads them:

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
  Application* certificate plus notarisation. Add these repository secrets and
  the workflow signs and notarises automatically:
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
- **Windows**: an OV or EV code-signing certificate from a CA. EV clears
  SmartScreen immediately; OV builds reputation over time.

Add the secrets yourself — they are credentials and should not be pasted into a
chat or a file in the repository.

## What ships inside the app

The Go daemon is bundled as a Tauri sidecar, so users install one thing. On
launch the app picks a free loopback port, generates a fresh API token, starts
the daemon, and shuts it down on exit. Nothing listens beyond `127.0.0.1`.
