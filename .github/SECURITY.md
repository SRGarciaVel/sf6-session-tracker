# Security Policy

SF6 Session Tracker is **pre-beta**. There is no production deployment yet, and no versions are
supported for security fixes other than the `main` branch.

## Reporting a vulnerability

**Please do not open public issues, discussions or pull requests for vulnerabilities**, including
anything that could expose user data, Capcom/Buckler sessions, companion device tokens or overlay
URLs.

- **Preferred:** GitHub **private vulnerability reporting** on this repository: go to
  [Security → Report a vulnerability](https://github.com/SRGarciaVel/sf6-session-tracker/security/advisories/new).
- **Otherwise:** contact the maintainer privately through the contact options on their GitHub
  profile, and ask for a private channel before sharing details.

Please include the affected component, steps to reproduce, the impact, and whether you tested
against your own local instance. Test only against **your own** local setup, never against other
users, Capcom or Buckler's Boot Camp.

## Scope and background

The threat model, known findings, accepted risks and production requirements are documented in
[docs/security-audit.md](../docs/security-audit.md).
