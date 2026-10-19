# Architecture

## Components

One Go binary, built from `cmd/server`, with the compiled SPA embedded.

| Part | Where | What it does |
| --- | --- | --- |
| Entry point | `cmd/server` | Reads the configuration, builds the handler, starts HTTP or HTTPS, shuts down on `SIGINT` and `SIGTERM` (10 seconds for requests in flight). Also implements `-healthcheck` for the container. |
| Configuration | `internal/config` | Parses and validates every `CCUI_*` variable and rejects unknown ones. |
| HTTP server | `internal/server` | Routes, security headers with the CSP nonce, the SPA file server. |
| Authentication | `internal/auth` | Sessions, local login, OIDC login, CSRF and Origin checks, login rate limit, roles. |
| Proxy | `internal/proxy` | One reverse proxy per cluster, the endpoint and parameter allow-list, the role gate, upstream authentication (none, basic, bearer, SigV4, OAuth2 client credentials), the audit log. |
| Password hashes | `internal/passwd` | Validates and checks bcrypt and argon2id hashes. |
| SPA | `web/src` | Preact, TypeScript and Vite. Built into `web/dist` and embedded with `go:embed`. |

The server has no database and no disk state. Sessions, login counters and OIDC flows in progress are in memory.

```text
                 /healthz /readyz      no session
                 GET /api/session      no session
                 POST /api/login       Origin check, rate limit
Browser -------> /api/auth/{p}/...     OIDC login and callback
                 /api/logout           session + CSRF
                 /api/clusters         session
                 /api/clusters/{name}/proxy/{endpoint}   session + CSRF (POST) + role + allow-list
                 everything else       embedded SPA (index.html fallback)
```

## Request flow

A click on "Simulate" in Admin becomes this:

1. The SPA sends `POST /api/clusters/prod/proxy/rebalance?dryrun=true` with the session cookie, `X-CSRF-Token` and an `Origin` header.
2. The security-headers middleware adds the response headers and a fresh CSP nonce.
3. The authentication layer finds the session, drops expired ones, and for a POST checks the CSRF token and the `Origin`. Failure is 401 or 403.
4. The cluster is looked up by name (404 `unknown cluster`).
5. For a known endpoint, the role is compared with the minimum for it (403). A POST always needs admin.
6. The endpoint, method and every query parameter are checked against the allow-list (404, 405, 400). POST endpoints with a dry run must say `dryrun=true` or `dryrun=false`.
7. With `AUTH_FORWARD_IDENTITY=jwt`, a user without an ID token gets 403 here.
8. The body is capped at `CCUI_MAX_BODY_BYTES` and a timeout of the cluster's `TIMEOUT` starts.
9. The request to Cruise Control is rebuilt from scratch: the URL from the configuration plus the endpoint name, the checked query plus `json=true` (and `doAs=<user>` for `doas`), and only the headers `Accept`, `User-Task-ID` and `Content-Type`. The cluster's authentication is added by its transport.
10. The response comes back with `Set-Cookie`, `WWW-Authenticate` and `Location` removed. A 401 from Cruise Control becomes a 502. Failures to connect become 502 and timeouts 504.
11. For a POST, one audit line is written with the final status.

## Asynchronous operations

Cruise Control answers slow requests with HTTP 202, a body that describes progress, and a `User-Task-ID` header. To get the result you send the same request again with that header. `state`, `load`, `partition_load`, `proposals` and every endpoint that moves data work this way.

The server keeps no state for this. It forwards `User-Task-ID` in the request and the response, and Cruise Control matches the repeat to the running task. The SPA does the waiting in `ccWait`:

1. Send the request. If the status is not 202, you are done.
2. Otherwise read `User-Task-ID`, report the progress, wait, and send the same request with the header. Page data waits 1.5 seconds between tries and the Admin task panel 2 seconds.
3. Stop on the first answer that is not 202 or on an error. Leaving the page cancels the wait.

The task panel is the same loop run from a global store, so it keeps going while you change page. A response that carries a request in `PENDING_REVIEW` (two-step verification) ends the loop with the state "waiting for review #N".

This is also why `max.active.user.tasks` matters on the Cruise Control side: each user task that has not finished holds a slot.

## The endpoint allow-list

`internal/proxy/table.go` lists 23 endpoints with their method and the exact query parameters each accepts, copied from Cruise Control's endpoint definitions (`yaml/endpoints/*.yaml`). A test compares the table with those files when the Cruise Control sources are present. The proxy forwards nothing outside the table, and within it only what the user's role allows. [Security](SECURITY.md#role-gate-per-cruise-control-endpoint) has the full table.

## The SPA and how it is served

The embedded files are served from `/`. `index.html` is never cached and gets the nonce in each `<script` tag. Files under `/assets/` have content hashes and are cached for a year. A path without a file extension that matches no file returns `index.html`, so client-side routes survive a reload. A path with an extension that matches no file is a 404. Paths with `..` are 404 before the router can redirect them.

Client routes: `/summary`, `/state`, `/cc-state`, `/config`, `/load`, `/partition-load`, `/proposals`, `/admin`, `/review` and `/tasks`. The SPA keeps the theme, the selected cluster and the refresh interval in `localStorage`. The session is only the cookie.

## Sessions and CSRF

A session is a 256-bit random id mapped to the user in a map guarded by a lock. Expired sessions are removed when a new one is created. The CSRF token is derived from the id with an HMAC, so nothing is stored for it. In `none` mode there is no session. A random per-process key signs the CSRF token (or `CCUI_SESSION_SECRET` if set) and the user is `anonymous` with the admin role.

## Failure behaviour

| Event | What happens |
| --- | --- |
| Cruise Control down | 502 `cluster unavailable` for that cluster. The others are not affected. The cluster dot turns red. |
| Cruise Control slow | 504 `cluster did not answer in time` after the cluster `TIMEOUT`. |
| Identity provider down at start | The server starts. The first sign-in answers 502 `identity provider unavailable`. |
| Process restart | All sessions end. Tasks running in Cruise Control are not affected. |
