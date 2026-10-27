# Third-party components

- [Playwright](https://github.com/microsoft/playwright), version 1.64.1, Apache-2.0. The browser base image and the unmodified Docker seccomp profile are from this release; the profile source is `utils/docker/seccomp_profile.json`.
- [Smokescreen](https://github.com/stripe/smokescreen), commit `68e7b8218e226bc47d09ce705fdb8fed82145ceb`, MIT. Its license is included in the built browser image at `/opt/oddhound/licenses/smokescreen.txt`.
- [mitmproxy](https://github.com/mitmproxy/mitmproxy), version 12.3.1, MIT. Package license metadata is retained in its installed Python environment.
- Other JavaScript dependency versions and integrity hashes are recorded in pnpm-lock.yaml. Their upstream licenses continue to apply.

Oddhound's gateway policy, browser tool implementation, fixture and user interface are original project code. This notice does not change the license of any upstream component.
