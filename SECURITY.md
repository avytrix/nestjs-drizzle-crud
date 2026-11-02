# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public issues, discussions or pull requests.**

Report privately through GitHub: [Report a vulnerability](https://github.com/avytrix/nestjs-drizzle-crud/security/advisories/new).
Only the maintainers can see the report.

Please include:

- what the vulnerability is and what an attacker could do with it
- steps to reproduce, ideally a minimal proof of concept
- the affected version or versions

We acknowledge reports within **72 hours**, work with you on a fix, and agree a
disclosure date. Please give us reasonable time to ship a fix before disclosing
publicly. We credit reporters in the advisory unless you prefer otherwise.

## Scope

In scope: the published npm package [`nestjs-drizzle-crud`](https://www.npmjs.com/package/nestjs-drizzle-crud)
(`packages/nestjs-drizzle-crud`).

Out of scope: `apps/api` and `apps/docs`. They are private examples and the docs
site, never published to npm. Problems there are still welcome as normal issues.

## Supported versions

| Version | Security fixes |
| ------- | -------------- |
| 3.x     | Yes            |
| < 3.0   | No             |

## How releases are protected

- Releases are published only by the `release.yml` workflow, from a `v*` tag, through
  [npm trusted publishing](https://docs.npmjs.com/trusted-publishers). No npm token exists
  in this repository.
- Every publish waits for a maintainer to approve the `github-drizzle-crud` environment.
- Each release carries an npm [provenance attestation](https://docs.npmjs.com/generating-provenance-statements)
  that links the package to the exact commit and workflow run. Verify it with `npm audit signatures`.
- Only maintainers can create release tags, and nobody can push to `main` directly.
- Secret scanning with push protection, CodeQL, Semgrep, Gitleaks and a dependency audit
  run on this repository. Every GitHub Action is pinned to a commit SHA.

Maintained by [Avytrix Technologies](https://avytrix.dev).
