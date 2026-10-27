# Escape Copy reader

The standalone tool that opens a MyOrganiser vault Escape Copy with no MyOrganiser server, no
MyOrganiser session, and no Google account — [ADR 0064](../adr/0064-an-escape-copy-is-opened-by-a-tool-that-needs-nothing-of-ours.md).

An Escape Copy is the file a local vault Export downloads and the file a Google Drive backup
uploads. They are the identical envelope, so one reader opens both.

## What it is

One self-contained HTML file. It carries its own stylesheet, its own script, and no reference to
anything outside itself: no stylesheet link, no script `src`, no font URL. Open it from `file://`
with the network cable out and it works.

It takes an Escape Copy and either the vault **passphrase** or the vault **Recovery Key**, and shows
the plaintext on screen, one section per Vault Blob Type. v1 writes no decrypted file to disk on
purpose — offering that would turn one deliberate act of recovery into a plaintext file the User
then has to remember to delete.

## Getting it, and verifying it

The reader is attached to every [GitHub Release](https://github.com/mnaimfaizy/myorganiser/releases)
as two assets:

| Asset                                 | What it is                          |
| ------------------------------------- | ----------------------------------- |
| `myorganiser-escape-copy-reader.html` | The reader.                         |
| `SHA256SUMS.txt`                      | Its SHA-256 digest, published here. |

**Verify before you type a passphrase into it.** A file that accepts a vault passphrase is exactly
the thing an attacker would like to substitute, and the app being reachable is not something this
tool is allowed to assume.

```bash
sha256sum myorganiser-escape-copy-reader.html
```

```bash
shasum -a 256 myorganiser-escape-copy-reader.html
```

```powershell
Get-FileHash myorganiser-escape-copy-reader.html -Algorithm SHA256
```

Compare the output against the line in `SHA256SUMS.txt`. If it does not match, do not open the file.

## Keep it beside the copy

Save the reader into the same folder as your Escape Copy, every time you make one. The vault page
prompts for this after a successful Export and after a successful Drive backup, because that is the
one moment a User is thinking about it. A copy you cannot open is not a backup, and the day you need
the copy is not a good day to go looking for the tool.

A reader you already verified and saved is also the answer to "what if the Releases page is gone" —
which is, after all, the scenario the whole feature is for.

## Building it locally

```bash
yarn escape-copy-reader:build
```

Writes `dist/escape-copy-reader/myorganiser-escape-copy-reader.html` and its `SHA256SUMS.txt`. The
output is deliberately **not** minified: a User asked to check a checksum is entitled to read what
they checked.

## How it is kept honest

```bash
yarn escape-copy-reader:check
```

Builds the reader, produces an envelope here and now with the real `exportVault` — the same function
the Export button and the Drive backup call — and opens it **with the built artifact**, not with the
sources it came from. It asserts:

- the envelope opens under the passphrase **and** under the Recovery Key;
- every Vault Blob Type round-trips to exactly the plaintext that went in, so a type the reader
  skips fails here rather than in somebody's hands;
- the reader was built for the schema version the exporter is producing today
  ([ADR 0064](../adr/0064-an-escape-copy-is-opened-by-a-tool-that-needs-nothing-of-ours.md)
  decision 2);
- the built page spaces itself from the design tokens in both directions — every CSS custom
  property it uses is one it also defines, and no spacing literal it writes is a value a token
  already carries;
- the built page contains no way to reach the network and no way to touch browser storage;
- the published checksum is the checksum of the published file.

It runs in CI, not in the pre-commit aggregate, because it builds a page and runs PBKDF2 four times.

## Where the code lives

| Path                                           | What                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `libs/vault-core/src/lib/escapeCopyReader.ts`  | `openEscapeCopy` — parse, unwrap, decrypt. The whole of the reader. |
| `libs/vault-core/src/lib/vaultCrypto.ts`       | The one crypto suite the app and the reader both run.               |
| `apps/escape-copy-reader/src/main.ts`          | The page: file picker, secret field, rendering. No crypto.          |
| `apps/escape-copy-reader/src/index.html`       | The page shell, with placeholders the build splices into.           |
| `tools/scripts/build-escape-copy-reader.ts`    | The build.                                                          |
| `tools/scripts/check-escape-copy-reader.ts`    | The gate.                                                           |
| `.github/workflows/publish-github-release.yml` | Builds and attaches the reader to each release.                     |

The split is load-bearing. The reader's crypto is **bundled from the app's own**, never hand-copied:
a reader with its own PBKDF2 or AES-GCM would be a second implementation of the one thing that must
never disagree with the first, and it would disagree silently.
