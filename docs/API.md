# API

These are the endpoints of the UI server itself, the ones the SPA uses. They are not Cruise Control's API, although `/api/clusters/{name}/proxy/{endpoint}` forwards to it. Nothing here is versioned; the contract is the one the bundled SPA needs.

Every error from the server has the same body:

```json
{"error":"authentication required"}
```

## Summary

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /healthz` | none | Liveness. `200` with the text `ok`. |
| `GET /readyz` | none | Readiness. `200` with the text `ok`. Does not check Cruise Control. |
| `GET /api/session` | none | Who am I, and the CSRF token. |
| `POST /api/login` | `Origin` | Local login (mode `local` only). |
| `POST /api/logout` | session, CSRF | End the session. |
| `GET /api/clusters` | session | Names and groups of the clusters. |
| `ANY /api/clusters/{name}/proxy/{endpoint}` | session, CSRF for POST | Forward to Cruise Control. |
| `GET /api/auth/{provider}/login` | none | Start an OIDC login (mode `oidc` only). |
| `GET /api/auth/{provider}/callback` | state cookie | Finish an OIDC login. |

Any other path under `/api/` answers 401 without a session and 404 `not found` with one. Paths outside `/api/` serve the SPA.

## Headers you need

| Header | When |
| --- | --- |
| `Cookie: ccui_session=...` | Every `/api/` call except the ones marked none above. |
| `X-CSRF-Token` | Every request that is not GET, HEAD or OPTIONS, on routes that have a session. The value is `csrfToken` from `/api/session`. |
| `Origin` | The same requests, and `/api/login`. Must equal `CCUI_PUBLIC_URL`, or the request's `Host` when that is unset. Browsers add it by themselves; curl does not. |
| `User-Task-ID` | Optional on the proxy route, to continue an asynchronous Cruise Control task. |
| `Accept: application/json` | Recommended. Forwarded to Cruise Control. |

## GET /api/session

Public. The SPA calls it first. The response is never cached (`Cache-Control: no-store`).

```json
{"authenticated":true,"mode":"local","user":"ana","role":"viewer","csrfToken":"9b0c...e1"}
```

Not signed in: `{"authenticated":false,"mode":"oidc","providers":["corp","partners"]}`. `providers` is present in `oidc` mode and lists the names for the login buttons. In `none` mode the answer is always authenticated, with user `anonymous`, role `admin` and a token.

## POST /api/login

Only in `local` mode (404 otherwise). Body is JSON of at most 4,096 bytes.

```sh
curl -si -c jar -H 'Origin: http://localhost:8080' \
  -d '{"username":"admin","password":"change this password"}' \
  http://localhost:8080/api/login
```

| Status | Meaning |
| --- | --- |
| 200 | `{"user":"admin","role":"admin"}` and a `Set-Cookie: ccui_session=...` header. |
| 400 | `invalid request`, the body is not the JSON above. |
| 401 | `invalid credentials`. Same answer for an unknown user and a wrong password. |
| 403 | `invalid Origin`. |
| 404 | The server is not in `local` mode. |
| 429 | `too many failed attempts, try again later`, with `Retry-After` in seconds. |

## POST /api/logout

Ends the session and clears the cookie. `200` `{"status":"logged out"}`. Needs the CSRF token and `Origin` like any POST.

## GET /api/clusters

```json
[{"name":"prod-eu","group":"prod"},{"name":"staging"}]
```

`group` is left out when empty. No URLs, no credentials.

## /api/clusters/{name}/proxy/{endpoint}

Forwards one request to Cruise Control. `{endpoint}` is a Cruise Control endpoint name from the [allow-list](SECURITY.md#role-gate-per-cruise-control-endpoint), `{name}` a cluster name. Parameters go in the query string, exactly as Cruise Control documents them, except `json` and `doAs`, which are refused. The response is Cruise Control's JSON, with its status and with the `User-Task-ID` header.

A complete session with curl, a read and then a dry run:

```sh
H='http://localhost:8080'
curl -s -c jar -H "Origin: $H" -d '{"username":"admin","password":"change this password"}' $H/api/login
TOKEN=$(curl -s -b jar $H/api/session | python3 -c 'import sys,json; print(json.load(sys.stdin)["csrfToken"])')

curl -s -b jar "$H/api/clusters/local/proxy/state?substates=EXECUTOR"

curl -si -b jar -X POST -H "Origin: $H" -H "X-CSRF-Token: $TOKEN" \
  "$H/api/clusters/local/proxy/rebalance?dryrun=true"
```

The Admin forms send these parameters, all already in the allow-list: to `rebalance`, `destination_broker_ids`, `data_from`, `kafka_assigner`, `use_ready_default_goals`, `allow_capacity_estimation` and `rebalance_disk`; to `topic_configuration`, `skip_rack_awareness_check`; to `admin`, `max_partition_movements_in_cluster`, `concurrent_intra_broker_partition_movements` and `execution_progress_check_interval_ms`. `replication_logdir_throttle` is refused with 400 on every endpoint.

If Cruise Control answers 202, repeat the same request with `-H "User-Task-ID: <value of the header you got>"` until the status changes.

| Status | Body or cause |
| --- | --- |
| 200, 202, 4xx, 5xx from Cruise Control | Passed through, except 401. |
| 400 | `parameter "x" is not accepted for rebalance`, or `parameter "dryrun" is required (true or false)`, or `parameter "dryrun" must be true or false`. |
| 401 | `authentication required`: no or expired session. |
| 403 | `your role does not allow this operation`. Or `missing or invalid CSRF token or Origin`. Or, with `AUTH_FORWARD_IDENTITY=jwt` and no token, `no identity token available to forward; sign in with OIDC`. |
| 404 | `unknown cluster` or `unknown endpoint`. |
| 405 | `method not allowed, use POST` (or GET). |
| 413 | `request body too large`. |
| 502 | `cluster unavailable`, or `cluster rejected the service credentials` when Cruise Control answered 401. |
| 504 | `cluster did not answer in time`. |

## OIDC routes

`GET /api/auth/{provider}/login` redirects (302) to the identity provider and sets the `ccui_oidc` cookie. It answers 404 `unknown provider` for a name that is not configured or when the mode is not `oidc`, and 502 `identity provider unavailable` when discovery fails.

`GET /api/auth/{provider}/callback` is the redirect URL registered at the provider. On success it sets `ccui_session` and redirects to `/`. Failures:

| Status | Error | Cause |
| --- | --- | --- |
| 400 | `invalid login state, start again` | Missing or reused `state`, the cookie is missing or does not match, or more than ten minutes passed. |
| 401 | `invalid identity token` | The ID token did not verify or the `nonce` is wrong. |
| 403 | `identity provider refused the login` | The provider sent back an `error`. |
| 403 | `your account has no role in this application` | No group matched and there is no `DEFAULT_ROLE`. |
| 403 | `this user name belongs to a local user` | See [Authentication](AUTHENTICATION.md#the-user-name). |
| 502 | `login failed` | The code exchange failed. |
| 502 | `identity provider unavailable` | Discovery failed. |
