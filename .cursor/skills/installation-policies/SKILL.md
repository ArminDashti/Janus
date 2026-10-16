---
name: installation-policies
description: >-
  Armin's rules for installing software: only official and trusted sources,
  always the latest stable version, verify it works, and report it in a grid. Use whenever asked to install, add, set up, or upgrade an app,
  package, framework, library, CLI, tool, extension, plugin, or dependency
  (winget, apt, npm, pip, NuGet, cargo, Docker image, VS Code/Cursor extension,
  installer download), on any OS or server.
author: "Armin Dashti"
uuid: 0a4ec3ba-94f0-4dfa-9fc2-67552697c12a
---
# 🛠️ Installation policies

Three rules. They always apply. User instructions for a specific install win only for that install.

1. **Only install from official and trusted sources.**
2. **Always install the latest version.**
3. **Verify it works; explain how to use it only if the user asks.**

## 🔒 Rule 1: Official and trusted sources only

Official means one of:

- The vendor's own website or download page
- The project's official GitHub/GitLab releases (the real org/repo, not a fork)
- Official package registries: npm, PyPI, NuGet, crates.io, Maven Central, Go modules, RubyGems
- OS package managers and official repos: winget (verified publisher), Microsoft Store, apt/dnf from the distro or the vendor's documented repo, Homebrew
- Docker Hub **Official** or **Verified Publisher** images, or the vendor's own registry
- The official extension marketplace for the editor/browser

Do:

- Prefer the OS package manager when it ships the official package (e.g. `winget` id from the real publisher, distro `apt` package).
- Check the package name and publisher carefully (watch for typosquats like `reqeusts`).
- Verify checksum or signature when the source offers one.

Never:

- Random mirrors, download sites, re-uploads, "portable"/repacked or cracked builds
- Unknown `curl … | sh` / `iwr … | iex` scripts; only use a pipe-to-shell installer if it is the vendor's documented method on its official domain
- Disabling signature/TLS checks to make an install work

If the official source is blocked or unreachable, report it and ask. Do not switch to an unofficial copy.

## 🆕 Rule 2: Latest version

- Install the **latest stable** release. No beta, RC, preview, or nightly unless the user asks.
- Check the latest version from the official source before installing (`winget show <id>`, `npm view <pkg> version`, `pip index versions <pkg>`, releases page).
- If the project pins a version (lockfile, `package.json` `engines`, `requirements.txt`, `global.json`, `.tool-versions`) or the latest is incompatible with the project/OS, **say so and ask** before overriding.
- If already installed but outdated, upgrade it (same source).
- Report the exact version installed.

## ✅ Rule 3: Verify, how-to only on request

1. Verify it works: run the version command (e.g. `<tool> --version`) or a minimal smoke test. If it fails, fix or report; do not claim success.
2. Do **not** add a how-to guide unless the user asks for one. If they ask, use the how-to template below.

## ⚠️ Also

- Ask before installing system-wide, admin/root-level, or global things the user did not request (services, drivers, PATH changes, global npm/pip packages).
- Prefer user-scope or project-local installs when either works.
- Never put secrets (API keys, tokens, passwords) in install commands or chat; use env vars or the tool's own login flow.
- Report what was installed, the version, the source, and where it lives.

## 📋 Output template (after install)

Report every install in a grid. Use the grid that matches what was installed (both if needed).

### 🖥️ Apps

| App | Source | Location |
|-----|--------|----------|
| GitHub Desktop | ☑️ [GitHub](https://desktop.github.com) | `C:\Users\<user>\AppData\Local\GitHubDesktop` |

### 📦 Packages, libraries, frameworks

| Name | Language | Source |
|------|----------|--------|
| Pandas | Python | ☑️ [PyPI](https://pypi.org/project/pandas/) |

### 🏷️ Source rules

- 🔗 **Source is always a hyperlink** with a short name as the text (e.g. `[GitHub](...)`). Never write the full URL as text.
- ☑️ **Blue tick** = official source (vendor site, official repo, official registry or verified publisher).
- No tick = trusted, safe source that is not the official one. Say why it was used.

### 🎓 How to use (only when the user asks)

```text
✅ Verified: <command> -> <output>
💡 What it is: <one sentence>
▶️ Start / run: <command or how to open>
⭐ Most useful:
- <command 1>  # what it does
- <command 2>
- <command 3>
⚙️ Config: <path to config file / settings>
🔄 Update: <command>
🗑️ Uninstall: <command>
📚 Docs: [<name> docs](<official docs URL>)
```