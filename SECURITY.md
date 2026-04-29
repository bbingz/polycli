# Security Policy

## Supported Versions

Security fixes target the latest public release line.

| Surface | Supported |
|---|---|
| Host plugins | Latest `0.x` release |
| `@bbingz/polycli-opencode` | Latest published version |
| `@bbingz/polycli-utils` | Latest `1.x` release |
| `@bbingz/polycli-timing` | Latest `1.x` release |

## Reporting A Vulnerability

Report security issues privately through GitHub Security Advisories for `bbingz/polycli`.

Please include:

- affected package or host plugin
- version or commit
- reproduction steps
- expected impact
- any relevant logs with secrets removed

Do not open a public issue for vulnerabilities involving credentials, local auth material, provider transcripts, or private repository data.

## Secret Handling

`polycli` invokes upstream provider CLIs as subprocesses and reuses local provider auth/config. It should not collect, upload, or host API keys. Public fixtures, docs, and package tarballs must not include maintainer-local paths, auth metadata, encrypted provider payloads, or provider reasoning signatures.

