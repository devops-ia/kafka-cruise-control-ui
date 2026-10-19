# Security

## Where the boundary is

The browser talks to this server and to nothing else. Cruise Control URLs, service credentials, client secrets and the user's ID token stay in the server process.

What the browser never sees:

- The Cruise Control URL of any cluster. The cluster list holds only names and groups, and the Config insights page shows nothing more.
- Cruise Control credentials of any type. They are added by the server on the way out, never put in a URL or a body, and never logged.
- The OIDC ID token and client secrets. The ID token is kept in the session in memory, only to forward the identity when `AUTH_FORWARD_IDENTITY=jwt`.
- `Set-Cookie`, `WWW-Authenticate` and `Location` headers from Cruise Control, which are removed from every response.

In the other direction, nothing from the browser reaches Cruise Control except three headers (`Accept`, `Content-Type` and `User-Task-ID`) and the checked query parameters. Cookies, `Authorization` and every other header are dropped. The upstream URL comes only from the configuration, so a client cannot make the server call anything else.

## Response headers

Every response, including errors and the SPA files, carries:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'nonce-<random>'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`, only when this process serves TLS (`CCUI_TLS_CERT` and `CCUI_TLS_KEY`) |

The nonce is 16 random bytes, new for each response. When the server returns `index.html` it adds that nonce to every `<script` tag, and the policy allows no other script. There is no `unsafe-inline` for scripts or styles. `index.html` is never cached (`Cache-Control: no-store`), while the hashed files under `/assets/` are cached for a year. Behind a TLS-terminating proxy, add HSTS at the proxy.

## CSRF and Origin

Cookies would let another site make a signed-in browser send requests, so every request that changes state (anything but GET, HEAD and OPTIONS) is checked twice:

1. `X-CSRF-Token` must match the token for the session. The token is the HMAC-SHA256 of the session id with `CCUI_SESSION_SECRET`, in hex. The SPA gets it from `GET /api/session`. It is useless without that session.
2. `Origin` must be present and equal the server's own origin: `CCUI_PUBLIC_URL` when set, otherwise the request's `Host`.

A failure answers 403 `missing or invalid CSRF token or Origin`. The login has no session and so no token yet. It requires a valid `Origin` only (403 `invalid Origin`). The session cookie is also `SameSite=Lax`.

## Login rate limit

Failed local logins are counted under two keys, the client address and the lowercased user name. Once either key reaches `CCUI_LOGIN_MAX_ATTEMPTS` failures inside `CCUI_LOGIN_WINDOW`, the login answers 429 with a `Retry-After` header until the window, counted from the first failure, ends. The right password does not get through while blocked. A successful login resets the user-name key only.

The counters live in memory, per process, and are cleared by a restart. The table is bounded: past 10,000 keys, expired entries are swept.

The client address is the peer address of the TCP connection, or with `CCUI_TRUST_XFF=true` the last entry of `X-Forwarded-For`. This has two consequences:

- Behind `kubectl port-forward`, a reverse proxy or a NAT, the peer address is the same for everyone. Five wrong passwords from one person block every account for the window. Behind a proxy, set `CCUI_TRUST_XFF=true`. Through a port-forward there is no real client address, so wait for the window or restart the pod.
- With `CCUI_TRUST_XFF=true` and a server that clients can reach directly, a client can send any `X-Forwarded-For` and pick its own address, which defeats the per-address count. The per-user count still applies.

## Audit log

Every POST to a Cruise Control endpoint writes one JSON line to standard output, whatever the result, including attempts refused for role or parameters. GET requests are not audited, and neither is a POST stopped earlier for a missing session or a bad CSRF token.

```json
{"time":"2026-10-19T21:30:12.4+02:00","level":"INFO","msg":"audit","user":"ana","role":"admin","cluster":"prod","endpoint":"rebalance","dryrun":"false","params":{"dryrun":"false","goals":"RackAwareGoal"},"status":202}
```

| Field | Content |
| --- | --- |
| `user`, `role` | Who, as shown in the UI. `anonymous` and `admin` in `none` mode. |
| `cluster`, `endpoint` | Which cluster and which Cruise Control endpoint. |
| `dryrun` | The `dryrun` parameter as sent, empty when the endpoint has none. |
| `params` | All query parameters, values joined with commas. |
| `status` | The HTTP status the browser received: 403 for a refused role, 400 for a rejected parameter, 202 or 200 from Cruise Control, 502 or 504 for a failure. |

Cookies, `Authorization` headers and tokens are never recorded. A failed sign-in is not an audit line; it is the `login failed` warning with the address. An OIDC sign-in refused because the name belongs to a local user writes a warning with `"msg":"audit","event":"oidc_login_refused"`.

## Role gate per Cruise Control endpoint

The server forwards only these endpoints, only with the method shown and only with the query parameters Cruise Control declares for that endpoint. The list is `internal/proxy/table.go`, and a test compares it with Cruise Control's own endpoint definitions. `json` and `doAs` are set by the server and rejected if the client sends them. Any other endpoint answers 404, a wrong method 405, an unknown parameter 400.

A `viewer` may call the five endpoints marked viewer. Everything else needs `admin`, and so does every POST.

| Endpoint | Method | Minimum role | `dryrun` required | Used by |
| --- | --- | --- | --- | --- |
| `add_broker` | POST | admin | yes | Admin |
| `admin` | POST | admin |  | Admin |
| `bootstrap` | GET | admin |  | no page, API only |
| `demote_broker` | POST | admin | yes | Admin |
| `fix_offline_replicas` | POST | admin | yes | Admin |
| `kafka_cluster_state` | GET | viewer |  | Cluster state, Summary |
| `load` | GET | viewer |  | Load |
| `partition_load` | GET | viewer |  | Partition load |
| `pause_sampling` | POST | admin |  | Admin |
| `permissions` | GET | viewer |  | Config insights |
| `proposals` | GET | admin |  | Proposals |
| `rebalance` | POST | admin | yes | Admin |
| `remove_broker` | POST | admin | yes | Admin |
| `remove_disks` | POST | admin | yes | no page, API only |
| `resume_sampling` | POST | admin |  | Admin |
| `review` | POST | admin |  | Peer review |
| `review_board` | GET | admin |  | Peer review |
| `rightsize` | POST | admin |  | no page, API only |
| `state` | GET | viewer |  | Cruise Control state, Summary, goal lists in Admin |
| `stop_proposal_execution` | POST | admin |  | Admin |
| `topic_configuration` | POST | admin | yes | Admin |
| `train` | GET | admin |  | no page, API only |
| `user_tasks` | GET | admin |  | User tasks |

For the endpoints with `dryrun` required, a request without `dryrun=true` or `dryrun=false` is refused with 400 `parameter "dryrun" is required (true or false)`. That is how the UI keeps Simulate and Execute apart: it never leaves the choice to a default.

The role check comes before the method check for known endpoints, so a viewer gets 403 for any POST, and unknown endpoints still get 404.

## Known limits

- Sessions are in memory. A restart signs everybody out, and several replicas need session affinity ([Deployment](DEPLOYMENT.md#several-replicas)).
- A role comes from the group claim at sign-in. Removing a user from a group at the identity provider does not end an existing session. It takes effect at the next login, or at the latest after `CCUI_SESSION_MAX_AGE`.
- With `AUTH_FORWARD_IDENTITY=jwt` the token is not renewed during the session.
- Local user changes need a restart. There is no password change or user management in the UI.
- Error bodies from Cruise Control, other than 401, pass through to the browser. They can name topics, brokers and configuration keys.
- A viewer can read broker, topic and partition information from the five viewer endpoints. There is no per-topic or per-cluster access control: every user may use every cluster the server lists.
- TLS certificates are read once at start.
- `CCUI_AUTH_MODE=none` protects nothing. Anyone who can reach the port can run a rebalance.
- The hard/soft grouping of goals in the Admin form is a naming heuristic. It only organises the form. Cruise Control decides which goals are hard.
