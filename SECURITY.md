# Security Policy

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting on this
repository ("Security" → "Report a vulnerability").

Please include: what is affected (contract, service, SDK, wallet), the impact,
and steps to reproduce. We aim to acknowledge within 72 hours.

## Scope

In scope: the Graviton contracts and services, the Guardian agent, `@mallow/sdk`,
and the wallet in this repository.

Out of scope: findings that require a compromised user device or a maliciously
modified build; the demo apps and marketing site, which live elsewhere.

## Note on Guardian

Guardian is an advisory tool. Its verdict is a heuristic and LLM-assisted
analysis, not a guarantee that a transaction is safe. A missed detection is a
bug worth reporting, but it is not by itself a vulnerability in the wallet.
