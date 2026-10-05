# Security Policy

## Reporting a vulnerability

Please use **Report a vulnerability** on this repository's GitHub Security tab if it is available. If that option is unavailable, open an issue asking for a private contact channel. Do not include exploit details, credentials or personal data in a public issue.

Include the affected route or component, the conditions needed to reproduce the issue, and its likely impact. Please give the maintainer time to investigate before publishing details.

## System boundary

This repository contains a public, read-only portfolio demo and the code for a separate Supabase-backed application mode. The hosted demo uses bundled fictional data. It must not access a live database or external data providers.

## Security properties

- Demo mode is selected on the server and must refuse to start when Supabase connection settings are present. A client-side flag must not grant access to live data.
- Demo pages may display sample data, but requests that change portfolio data must be blocked before application actions run. The reset route may clear display preferences only.
- Browser requests from the demo must remain on the app's origin. Its Content Security Policy must not permit external connections.
- In the Supabase-backed mode, access to portfolio data must require an authenticated owner with a recently verified, approved TOTP factor. Database Row Level Security and privileged database functions must enforce this boundary independently of page routing.
- Credentials and personal portfolio data must not be committed to this repository, included in demo data or printed in CI logs.

## Findings to report

Please report a credible path to unauthorised data access or modification, a bypass of the demo boundary or live authentication, exposure of a credential or personal data, or a way for the demo to send data to an external service. Include realistic reachability and impact. No classes of security findings are excluded by this policy.
