# Security policy

## LocalStripe is not a payment system

LocalStripe is a **mock for development and testing**. It does not process payments, move money,
connect to banks, card networks or Stripe, and must **never** be used in production or exposed to
the public internet. It only accepts the card numbers listed in its test card catalog.

If you find LocalStripe deployed somewhere as if it were a real payment processor, that deployment is
misusing the project.

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/SebasRaul2503/localstripe/security/advisories/new)
rather than public issues. Include the version or commit, steps to reproduce and the impact you see.
You can expect an acknowledgement within a few days.

Relevant findings include, for example: a way to make LocalStripe store or log a full card number or
CVC, authentication bypasses on the API or dashboard proxy, the secret key reaching the browser,
signature verification weaknesses, or injection in the hosted pages.

## Supported versions

Only the latest release receives fixes.

See the [Security considerations](README.md#security-considerations) section of the README for the
measures LocalStripe implements.
