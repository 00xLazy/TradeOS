# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in TradeOS, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, send an email to the maintainer or use [GitHub Security Advisories](https://github.com/00xLazy/TradeOS/security/advisories/new) to report the issue privately.

Please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact assessment
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Security Architecture

TradeOS handles sensitive financial credentials. The following measures are enforced at the code level:

| Layer | Mechanism |
|-------|-----------|
| Encryption | AES-256-GCM with PBKDF2-derived keys (600,000 iterations) |
| Key Storage | Local filesystem only (`~/.openclaw/skills/TradeOS/vault/`) |
| Withdrawal Protection | API keys with withdrawal permissions are automatically rejected |
| Trade Execution | Mandatory preview + explicit confirmation before any live order |
| Log Sanitization | API keys are masked in all logs and AI chat outputs |
| File Permissions | All data files are set to `chmod 600` (owner read/write only) |
| Risk Controls | Configurable per-trade limits, daily caps, leverage ceiling, and cooldowns |

## Scope

The following are considered in-scope for security reports:

- Encryption bypasses or key material leakage
- Unauthorized trade execution (bypassing the confirmation flow)
- API key exposure in logs, error messages, or chat outputs
- Path traversal or file access outside the designated data directory
- Risk control bypasses

## Out of Scope

- Vulnerabilities in third-party dependencies (report to the respective project)
- Exchange-side API security (IP whitelisting, permissions) — this is user responsibility
- Social engineering attacks

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.4.x   | Yes       |
| < 0.4   | No        |
