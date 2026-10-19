# Configuration

Everything is configured with environment variables that start with `CCUI_`. There is no config file. The server reads them once at start, validates all of them, and exits with status 1 and a message that names each wrong variable. A restart is needed to change anything.

## Rules that apply to every variable

| Rule | Detail |
| --- | --- |
| Unknown variables fail | Any `CCUI_*` variable the server does not read is an error (`CCUI_FOO: unknown variable`). A typo in a security setting cannot silently turn it off. |
| Empty equals unset | `CCUI_LISTEN=` behaves as if the variable were absent. |
| Booleans | Only the exact text `true` turns `CCUI_COOKIE_INSECURE` and `CCUI_TRUST_XFF` on. `1`, `TRUE` and `yes` leave them off. |
| Durations | Go syntax with a unit and greater than zero: `30s`, `15m`, `12h`, `1h30m`. `60` is rejected. |
| Integers | Positive whole numbers. |
| Lists | Comma separated, spaces around items are ignored: `ccui-admins, platform`. |
| Indexed groups | `CCUI_CLUSTERS__<n>__*`, `CCUI_OIDC__<n>__*` and `CCUI_LOCAL_USERS__<n>__*` are numbered from 0 with no gaps. Each group counts on its own. |
| Variables of other modes | `CCUI_OIDC__*` set while `CCUI_AUTH_MODE=local` is read and checked for syntax but not used. |

### Secrets and the `_FILE` form

Seven variables hold secrets. Each accepts the value directly (`NAME`) or the path of a file that holds it (`NAME_FILE`). Set one of them, not both: with the file set, the direct variable is reported as `unknown variable`. A trailing newline is removed. The file is read at start, so a rotated secret needs a restart.

| Secret | `_FILE` form |
| --- | --- |
| `CCUI_SESSION_SECRET` | `CCUI_SESSION_SECRET_FILE` |
| `CCUI_LOCAL_ADMIN_PASSWORD_HASH` | `CCUI_LOCAL_ADMIN_PASSWORD_HASH_FILE` |
| `CCUI_LOCAL_USERS__<n>__PASSWORD_HASH` | `CCUI_LOCAL_USERS__<n>__PASSWORD_HASH_FILE` |
| `CCUI_CLUSTERS__<n>__AUTH_PASSWORD` | `CCUI_CLUSTERS__<n>__AUTH_PASSWORD_FILE` |
| `CCUI_CLUSTERS__<n>__AUTH_TOKEN` | `CCUI_CLUSTERS__<n>__AUTH_TOKEN_FILE` |
| `CCUI_CLUSTERS__<n>__AUTH_OIDC_CLIENT_SECRET` | `CCUI_CLUSTERS__<n>__AUTH_OIDC_CLIENT_SECRET_FILE` |
| `CCUI_OIDC__<n>__CLIENT_SECRET` | `CCUI_OIDC__<n>__CLIENT_SECRET_FILE` |

This is how Kubernetes and Docker secrets are mounted. Secret values are never written to the log. An unreadable file fails with `CCUI_SESSION_SECRET_FILE: cannot read file`.

```env
CCUI_AUTH_MODE=local
CCUI_SESSION_SECRET_FILE=/run/secrets/ccui_session_secret
CCUI_LOCAL_ADMIN_PASSWORD_HASH_FILE=/run/secrets/ccui_admin_hash
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
CCUI_CLUSTERS__0__AUTH_TYPE=basic
CCUI_CLUSTERS__0__AUTH_USER=ccui
CCUI_CLUSTERS__0__AUTH_PASSWORD_FILE=/run/secrets/cc_prod_password
```

## Server

| Variable | Default | Meaning |
| --- | --- | --- |
| `CCUI_AUTH_MODE` | `local` | `none`, `local` or `oidc`. See [Authentication](AUTHENTICATION.md). |
| `CCUI_LISTEN` | `:8080` | Address the server binds to, for example `127.0.0.1:8080`. The container healthcheck probes the port of this value. |
| `CCUI_TLS_CERT` | none | Path of a PEM certificate. Must be set together with `CCUI_TLS_KEY`. Turns on HTTPS (TLS 1.2 or newer) and the `Strict-Transport-Security` header. |
| `CCUI_TLS_KEY` | none | Path of the PEM private key. |
| `CCUI_PUBLIC_URL` | none | The origin users type in the browser, for example `https://cc.example.com`, without a path. A trailing `/` is removed. Required with `oidc`. Also fixes the origin the CSRF check accepts. |
| `CCUI_MAX_BODY_BYTES` | `1048576` | Largest request body the proxy accepts for Cruise Control. Larger bodies get 413. The SPA sends query parameters only, so the default is plenty. |

## Sessions and login protection

| Variable | Default | Meaning |
| --- | --- | --- |
| `CCUI_SESSION_SECRET` | none | At least 32 characters. Required with `local` and `oidc`. Signs the CSRF tokens. Use the same value on every replica. |
| `CCUI_SESSION_IDLE_TIMEOUT` | `30m` | A session with no request for this long ends. |
| `CCUI_SESSION_MAX_AGE` | `12h` | A session ends this long after login, however active. It is also the cookie's `Max-Age`. |
| `CCUI_COOKIE_INSECURE` | `false` | `true` drops the `Secure` flag from the session cookie. Only for plain-HTTP development. |
| `CCUI_LOGIN_MAX_ATTEMPTS` | `5` | Failed local logins allowed per client address and per user name inside the window. |
| `CCUI_LOGIN_WINDOW` | `15m` | The window, counted from the first failure. After `CCUI_LOGIN_MAX_ATTEMPTS` failures the login answers 429 until it ends. |
| `CCUI_TRUST_XFF` | `false` | `true` takes the client address for the rate limit and the log from the last entry of `X-Forwarded-For`. Set it only behind a proxy that appends the address. |

Generate a secret:

```sh
openssl rand -base64 48
```

## Local users

Used with `CCUI_AUTH_MODE=local`. At least one user is required, either with the shortcut or with numbered users, or both. Names must be unique across both forms. An OIDC user whose name equals a local user is refused at sign-in. The hash must be bcrypt or argon2id, never plain text. How to make one is in [Authentication](AUTHENTICATION.md#generate-a-password-hash).

| Variable | Default | Meaning |
| --- | --- | --- |
| `CCUI_LOCAL_ADMIN_PASSWORD_HASH` | none | Shortcut for one admin user. |
| `CCUI_LOCAL_ADMIN_USER` | `admin` | Name of the shortcut user. In `local` mode setting only this variable, without the hash, is an error. |
| `CCUI_LOCAL_USERS__<n>__NAME` | none | User name. Required for each numbered user. |
| `CCUI_LOCAL_USERS__<n>__PASSWORD_HASH` | none | Required for each numbered user. |
| `CCUI_LOCAL_USERS__<n>__ROLE` | none | `viewer` or `admin`. Required for each numbered user. |

## Clusters

At least one cluster is required in every mode. `<n>` starts at 0.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CCUI_CLUSTERS__<n>__NAME` | none | Unique. Letters, digits, `.`, `_` and `-`. Appears in the cluster selector and in the API path. |
| `CCUI_CLUSTERS__<n>__URL` | none | `http` or `https` URL of Cruise Control including its API prefix, for example `http://cc.kafka:9090/kafkacruisecontrol`. A trailing `/` is removed. |
| `CCUI_CLUSTERS__<n>__GROUP` | none | Groups clusters in the selector. Clusters without one appear under "Ungrouped". |
| `CCUI_CLUSTERS__<n>__TIMEOUT` | `60s` | Time limit for each request to this cluster. A slower answer becomes 504. |
| `CCUI_CLUSTERS__<n>__AUTH_TYPE` | `none` | How the server authenticates to Cruise Control: `none`, `basic`, `bearer`, `sigv4` or `oidc`. |
| `CCUI_CLUSTERS__<n>__AUTH_USER` | none | Required with `basic`. |
| `CCUI_CLUSTERS__<n>__AUTH_PASSWORD` | none | Required with `basic`. |
| `CCUI_CLUSTERS__<n>__AUTH_TOKEN` | none | Required with `bearer`. |
| `CCUI_CLUSTERS__<n>__AUTH_SIGV4_REGION` | none | Required with `sigv4`, for example `eu-west-1`. |
| `CCUI_CLUSTERS__<n>__AUTH_SIGV4_SERVICE` | `execute-api` | Service name used when signing. |
| `CCUI_CLUSTERS__<n>__AUTH_OIDC_TOKEN_URL` | none | Required with `oidc`. Token endpoint of the OAuth2 client-credentials grant. |
| `CCUI_CLUSTERS__<n>__AUTH_OIDC_CLIENT_ID` | none | Required with `oidc`. |
| `CCUI_CLUSTERS__<n>__AUTH_OIDC_CLIENT_SECRET` | none | Required with `oidc`. |
| `CCUI_CLUSTERS__<n>__AUTH_OIDC_SCOPE` | none | Scopes to request, separated by spaces or commas. |
| `CCUI_CLUSTERS__<n>__AUTH_FORWARD_IDENTITY` | off | `jwt` or `doas`. See [Clusters](CLUSTERS.md#forwarding-the-user-identity). |

Examples for each `AUTH_TYPE` are in [Clusters](CLUSTERS.md#authenticating-to-cruise-control).

## OIDC providers

Used with `CCUI_AUTH_MODE=oidc`, which also needs `CCUI_PUBLIC_URL` and `CCUI_SESSION_SECRET`. At least one provider is required.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CCUI_OIDC__<n>__NAME` | none | Unique. Lowercase letters, digits and `-`. Shown on the sign-in button and used in the callback path. |
| `CCUI_OIDC__<n>__ISSUER` | none | Issuer URL. The server fetches `<issuer>/.well-known/openid-configuration`. |
| `CCUI_OIDC__<n>__CLIENT_ID` | none | |
| `CCUI_OIDC__<n>__CLIENT_SECRET` | none | |
| `CCUI_OIDC__<n>__REDIRECT_URL` | `<CCUI_PUBLIC_URL>/api/auth/<name>/callback` | Override only if the provider needs a different URL than the default. |
| `CCUI_OIDC__<n>__SCOPES` | `openid profile email` | Separated by spaces or commas. |
| `CCUI_OIDC__<n>__GROUPS_CLAIM` | `groups` | Name of the claim in the ID token that holds the groups. |
| `CCUI_OIDC__<n>__ADMIN_GROUPS` | none | Groups that get the `admin` role. |
| `CCUI_OIDC__<n>__VIEWER_GROUPS` | none | Groups that get the `viewer` role. |
| `CCUI_OIDC__<n>__DEFAULT_ROLE` | none | `viewer` or `admin` for users who match no group. Without it they are refused. |

## Complete examples

One cluster, one admin:

```env
CCUI_AUTH_MODE=local
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_LOCAL_ADMIN_PASSWORD_HASH=$2a$10$jDy/91QpAa9CaSz6CQ1YX.uzTI0uNvUjh0c6H2P.2w8Zqa1433ism
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

Two clusters in two groups, behind an ingress with TLS terminated there:

```env
CCUI_AUTH_MODE=local
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_PUBLIC_URL=https://cc.example.com
CCUI_TRUST_XFF=true
CCUI_SESSION_IDLE_TIMEOUT=15m
CCUI_SESSION_MAX_AGE=8h
CCUI_LOCAL_ADMIN_USER=ops
CCUI_LOCAL_ADMIN_PASSWORD_HASH=$2a$10$jDy/91QpAa9CaSz6CQ1YX.uzTI0uNvUjh0c6H2P.2w8Zqa1433ism
CCUI_LOCAL_USERS__0__NAME=ana
CCUI_LOCAL_USERS__0__PASSWORD_HASH=$2a$10$jDy/91QpAa9CaSz6CQ1YX.uzTI0uNvUjh0c6H2P.2w8Zqa1433ism
CCUI_LOCAL_USERS__0__ROLE=viewer
CCUI_CLUSTERS__0__NAME=prod-eu
CCUI_CLUSTERS__0__GROUP=prod
CCUI_CLUSTERS__0__URL=http://cc-eu.kafka.svc:9090/kafkacruisecontrol
CCUI_CLUSTERS__0__AUTH_TYPE=basic
CCUI_CLUSTERS__0__AUTH_USER=ccui
CCUI_CLUSTERS__0__AUTH_PASSWORD=replace-me
CCUI_CLUSTERS__1__NAME=staging
CCUI_CLUSTERS__1__GROUP=dev
CCUI_CLUSTERS__1__URL=http://cc-staging.kafka.svc:9090/kafkacruisecontrol
CCUI_CLUSTERS__1__TIMEOUT=120s
```

## Validation and error messages

The server reports every problem it finds in one run, on standard error, before anything listens. These are the messages for the mistakes people make most.

| Mistake | Message |
| --- | --- |
| Misspelled or removed variable | `CCUI_FOO: unknown variable` |
| Mode other than the three | `CCUI_AUTH_MODE: must be none, local or oidc, got "ldap"` |
| `local` or `oidc` without a long secret | `CCUI_SESSION_SECRET: required with CCUI_AUTH_MODE=local, at least 32 characters (or CCUI_SESSION_SECRET_FILE)` |
| `local` without any user | `CCUI_LOCAL_USERS__0__NAME: CCUI_AUTH_MODE=local needs at least one local user (CCUI_LOCAL_USERS__<n>__* or CCUI_LOCAL_ADMIN_PASSWORD_HASH)` |
| Missing hash | `CCUI_LOCAL_ADMIN_PASSWORD_HASH: required with CCUI_AUTH_MODE=local` |
| Plain-text password in a hash variable | `CCUI_LOCAL_ADMIN_PASSWORD_HASH: must be a bcrypt or argon2id hash, not plain text` |
| Bad role | `CCUI_LOCAL_USERS__0__ROLE: must be viewer or admin, got "operator"` |
| Same user name twice | `CCUI_LOCAL_USERS__1__NAME: duplicate local user name "ana"` |
| No cluster at all | `at least one cluster is required: set CCUI_CLUSTERS__0__NAME and CCUI_CLUSTERS__0__URL` |
| Cluster numbering skips 0 or leaves a gap | `CCUI_CLUSTERS__0__: index 0 is missing, indexes must be consecutive from 0`, followed by `unknown variable` for the variables of the cluster that was skipped |
| URL without a scheme | `CCUI_CLUSTERS__0__URL: must be an http(s) URL, got "cc:9090/x"` |
| Duration without a unit | `CCUI_CLUSTERS__0__TIMEOUT: must be a positive duration such as 30s, got "60"` |
| Count that is not a positive integer | `CCUI_LOGIN_MAX_ATTEMPTS: must be a positive integer, got "0"` |
| Cluster name with a space or a slash | `CCUI_CLUSTERS__0__NAME: required, only letters, digits, '.', '_' and '-' are allowed` |
| Same cluster name twice | `CCUI_CLUSTERS__1__NAME: duplicate cluster name "prod"` |
| Credentials missing for the auth type | `CCUI_CLUSTERS__0__AUTH_USER: required with AUTH_TYPE=basic` |
| Unknown auth type | `CCUI_CLUSTERS__0__AUTH_TYPE: must be none, basic, bearer, sigv4 or oidc, got "oauth"` |
| Unknown identity forwarding | `CCUI_CLUSTERS__0__AUTH_FORWARD_IDENTITY: must be jwt or doas, got "x"` |
| Only one of certificate and key | `CCUI_TLS_KEY: CCUI_TLS_CERT and CCUI_TLS_KEY must be set together` |
| `oidc` without providers | `CCUI_OIDC__0__: CCUI_AUTH_MODE=oidc needs at least one provider (CCUI_OIDC__0__NAME, ISSUER, CLIENT_ID, CLIENT_SECRET)` |
| `oidc` without a public URL | `CCUI_PUBLIC_URL: required with CCUI_AUTH_MODE=oidc` |
| Public URL without a scheme | `CCUI_PUBLIC_URL: must be an http(s) URL` |
| Provider name in capitals | `CCUI_OIDC__0__NAME: required, lowercase letters, digits and '-' only` |
| Provider default role wrong | `CCUI_OIDC__0__DEFAULT_ROLE: must be viewer or admin` |

Two problems show up only after the server is running, not at start. The `sigv4` credentials are resolved on the first request, so a missing AWS role shows up as a 502 on use. OIDC discovery runs on the first sign-in, so an unreachable identity provider does not stop the UI from starting. It answers 502 `identity provider unavailable` instead.

## What the server logs

Logs are JSON lines on standard output. At start there is one `config` line (mode, listen address, whether TLS is on, number of clusters and providers), one `cluster` line per cluster (name, group, auth type, identity forwarding) and a warning when the mode is `none`. No secret and no URL is logged. Failed local logins log the client address but not the user name. Every POST to Cruise Control adds an [audit line](SECURITY.md#audit-log).
