# Troubleshooting

Start with the server log. It is JSON on standard output, and startup problems are printed on standard error before anything listens.

## Startup fails with "unknown variable"

```text
invalid configuration:
CCUI_PORT: unknown variable
```

The server rejects every `CCUI_*` variable it does not read. Four usual causes:

- A typo or a variable from an older version, such as `CCUI_OPERATOR_GROUPS` or `CCUI_AUTH_MODE` spelled `CCUI_AUTHMODE`. The name in the message tells you which one. [Configuration](CONFIGURATION.md) has the full list.
- A gap in the numbering. With `CCUI_CLUSTERS__1__NAME` but no index 0, you get `index 0 is missing` followed by `unknown variable` for the variables of the cluster that was skipped.
- Kubernetes service links. Kubernetes adds `<SERVICE>_SERVICE_HOST`, `<SERVICE>_PORT` and similar variables to every pod for every Service in the namespace. A Service named `ccui` produces `CCUI_SERVICE_HOST` and `CCUI_PORT`. Set `enableServiceLinks: false` in the pod spec, or rename the Service.
- Both `CCUI_X` and `CCUI_X_FILE` set for a secret. The file wins and the direct variable is reported as unknown. Set only one.

## Login answers 429 and the right password does not work

You hit the failed-login limit: 5 failures in 15 minutes by default, counted per client address and per user name. The response has a `Retry-After` header with the seconds left. The right password is refused while the block lasts.

Behind `kubectl port-forward` the server sees every connection as coming from the same local address, so one person's mistakes lock out everybody, for any account. The same happens behind a reverse proxy when `CCUI_TRUST_XFF` is off.

- Behind a proxy that appends `X-Forwarded-For`, set `CCUI_TRUST_XFF=true`.
- Through a port-forward, wait for the window or restart the pod. For a long debugging session you can raise `CCUI_LOGIN_MAX_ATTEMPTS`.

## Logging in works, but the page returns to the login form

The login answered 200 and `GET /api/session` still says `"authenticated":false`. The browser did not keep the session cookie. It is flagged `Secure`, and browsers refuse to store a `Secure` cookie that arrives over plain HTTP, with an exception for `localhost` in some of them. Serve the UI over HTTPS (through TLS in the server or a proxy), or for local development only set `CCUI_COOKIE_INSECURE=true`.

If you terminate TLS at a proxy, also check that it passes the `Set-Cookie` header through untouched.

## 403 "missing or invalid CSRF token or Origin"

State-changing requests need an `Origin` header equal to the server's origin and the right `X-CSRF-Token`. From a browser the usual cause is a proxy that changes the `Host` header, so the origin the browser sends (`https://cc.example.com`) no longer matches. Set `CCUI_PUBLIC_URL=https://cc.example.com` exactly as users type it, without a path.

From curl, add `-H 'Origin: http://localhost:8080'` and the token from `/api/session`. The login only needs the `Origin`.

## 403 on Peer review when two-step verification is off

Cruise Control rejects `review_board` when `two.step.verification.enabled` is `false`. The page recognises the message and shows "Two-step verification is disabled on this cluster, so there is nothing to review". If you see a red error with a 403 instead, the message from Cruise Control does not mention `two.step.verification`, which means the 403 comes from somewhere else: a viewer role, or a security setting of Cruise Control that denies the service account.

## Config insights shows "Security is disabled on this cluster"

Cruise Control answers the `permissions` endpoint with 400 and the text `Unable to retrieve privilege information for an unsecure connection` when `webserver.security.enable` is `false`. The page treats it as a state, not an error. If you want per-user permissions there, turn security on in Cruise Control.

## Load, Partition load and Proposals fail with NotEnoughValidWindows

Cruise Control has not collected enough metric windows to build its model, usually just after it started or after sampling was paused. The page shows Cruise Control's own message. Open Cruise Control state, then Monitor and Analyzer, and check the monitored windows and the coverage. Wait, or check that the metric sampler works. The UI only shows what Cruise Control reports. Resume sampling in Admin if it was paused.

## "There are already 5 active user tasks, which has reached the servlet capacity"

Cruise Control limits concurrent asynchronous tasks with `max.active.user.tasks` (default 5) across all its users. `state`, `load`, `partition_load`, `proposals` and every data-moving operation count while they run. Several people with auto-refresh on heavy pages, or a long Proposals computation, can use all five. Wait a moment, switch auto-refresh off, or raise the setting in `cruisecontrol.properties` and restart Cruise Control.

## 502 "cluster rejected the service credentials"

Cruise Control answered 401. The UI turns it into a 502 so users are not signed out. Check the cluster's `AUTH_TYPE` and the user, password, token or client credentials. With `AUTH_FORWARD_IDENTITY=jwt`, the user's ID token may have expired: signing in again gives a new one.

## 502 "cluster unavailable" or 504 "cluster did not answer in time"

502 is a connection error: wrong host or port, DNS, a network policy, a missing AWS role for `sigv4`, or a failing token request for client-credentials. The log line `upstream error` carries the reason. 504 means the cluster did not answer within `CCUI_CLUSTERS__<n>__TIMEOUT` (60 seconds). Raise the timeout for slow clusters.

## Every page shows 404 for one cluster

The cluster `URL` does not end with Cruise Control's API prefix. With the default `webserver.api.urlprefix=/kafkacruisecontrol/*` the URL ends with `/kafkacruisecontrol`.

## OIDC: "this user name belongs to a local user"

The user name taken from the ID token (`preferred_username`, then `email`, `name`, `sub`) equals a configured local user, often `admin`. The sign-in is refused on purpose. Rename the local user, for example `CCUI_LOCAL_ADMIN_USER=ccui-admin`, or change the claim your provider sends. The log has a warning with `"event":"oidc_login_refused"`.

## OIDC: "your account has no role in this application"

No group of the user matches `ADMIN_GROUPS` or `VIEWER_GROUPS` and no `DEFAULT_ROLE` is set. Decode the ID token and look at the claim named by `GROUPS_CLAIM`. Common reasons: the provider does not release groups without an extra scope (add it to `SCOPES`), Entra sends object IDs and not names, or Keycloak sends full paths starting with `/`.

## OIDC: "invalid login state, start again"

The callback did not find the login it belongs to. Causes: the `ccui_oidc` cookie did not come back (the `Secure` flag over HTTP, as above), more than ten minutes passed on the provider's page, the callback landed on another replica than the login (add session affinity), or the page was reloaded after the callback.

## OIDC: the provider shows a redirect URI mismatch

The registered URL differs from `<CCUI_PUBLIC_URL>/api/auth/<name>/callback`. Compare scheme, host, port and the provider `NAME`, character by character.

## Viewers get "403 Forbidden" on a page

By design. Only Overview and Load are open to viewers. See [Authentication](AUTHENTICATION.md#roles).

## The task panel disappeared

It lives in the browser's memory, so a reload or a new tab empties it. The operation continues in Cruise Control. Find it in User tasks.
