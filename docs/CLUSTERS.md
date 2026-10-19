# Clusters

One server talks to as many Cruise Control clusters as you list. Each cluster has its own URL, timeout and credentials, and the browser only ever sees its name and group.

## Several clusters and groups

Number the clusters from 0 with no gaps. `NAME` and `URL` are required. `GROUP` only affects the cluster selector in the top bar, which lists the clusters under their group (clusters without one go under "Ungrouped"). The Summary page shows every cluster in one table.

```env
CCUI_AUTH_MODE=none
CCUI_CLUSTERS__0__NAME=prod-eu
CCUI_CLUSTERS__0__GROUP=prod
CCUI_CLUSTERS__0__URL=http://cc-eu.kafka.svc:9090/kafkacruisecontrol
CCUI_CLUSTERS__1__NAME=prod-us
CCUI_CLUSTERS__1__GROUP=prod
CCUI_CLUSTERS__1__URL=http://cc-us.kafka.svc:9090/kafkacruisecontrol
CCUI_CLUSTERS__2__NAME=staging
CCUI_CLUSTERS__2__GROUP=dev
CCUI_CLUSTERS__2__URL=http://cc-staging.kafka.svc:9090/kafkacruisecontrol
CCUI_CLUSTERS__2__TIMEOUT=120s
```

The URL is the base of the Cruise Control REST API, including its prefix and without a trailing slash. The server appends the endpoint name, so the example above calls `http://cc-eu.kafka.svc:9090/kafkacruisecontrol/state`. `TIMEOUT` limits each request to that cluster (default `60s`); a cluster that does not answer in time gives the browser a 504.

The selected cluster is remembered in the browser. A coloured dot next to the selector shows whether the cluster answered its last check, which runs every 30 seconds with a `state` call.

## Authenticating to Cruise Control

`AUTH_TYPE` sets what the server sends to Cruise Control. It applies to all users of that cluster. It is independent of how people sign in to the UI.

### none

The default. No `Authorization` header. Use it when Cruise Control sits on a private network and has no security enabled.

### basic

```env
CCUI_AUTH_MODE=none
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
CCUI_CLUSTERS__0__AUTH_TYPE=basic
CCUI_CLUSTERS__0__AUTH_USER=ccui
CCUI_CLUSTERS__0__AUTH_PASSWORD=replace-me
```

Sends `Authorization: Basic ...`. This matches Cruise Control's default security provider with a credentials file.

### bearer

```env
CCUI_AUTH_MODE=none
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=https://cc.example.com/kafkacruisecontrol
CCUI_CLUSTERS__0__AUTH_TYPE=bearer
CCUI_CLUSTERS__0__AUTH_TOKEN=replace-me
```

Sends the fixed token as `Authorization: Bearer <token>`. The server does not refresh it.

### sigv4

Signs each request with AWS Signature Version 4. The credentials come from the default AWS chain: environment variables, shared config, a web identity token (IRSA on EKS) or an instance role. The usual case is an API Gateway with IAM authorization in front of an internal load balancer that reaches Cruise Control. The service name `execute-api` is the default; change it with `AUTH_SIGV4_SERVICE` for another AWS service that verifies SigV4.

```env
CCUI_AUTH_MODE=none
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=https://abc123.execute-api.eu-west-1.amazonaws.com/prod/kafkacruisecontrol
CCUI_CLUSTERS__0__AUTH_TYPE=sigv4
CCUI_CLUSTERS__0__AUTH_SIGV4_REGION=eu-west-1
```

An Application Load Balancer does not check SigV4 signatures, so the setting has no effect on a plain ALB. The role needs `execute-api:Invoke` on the API.

!!! warning
    Credentials are resolved on the first request, not at start. A pod without an AWS role starts fine and answers 502 `cluster unavailable` until the role is fixed. Look for the cause in the log line `upstream error`.

### oidc

Gets an access token with the OAuth2 client-credentials grant and sends it as a Bearer token. The token is cached and fetched again 30 seconds before it expires. When the provider does not report a lifetime, the server assumes one hour.

```env
CCUI_AUTH_MODE=none
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=https://cc.example.com/kafkacruisecontrol
CCUI_CLUSTERS__0__AUTH_TYPE=oidc
CCUI_CLUSTERS__0__AUTH_OIDC_TOKEN_URL=https://keycloak.example.com/realms/ops/protocol/openid-connect/token
CCUI_CLUSTERS__0__AUTH_OIDC_CLIENT_ID=ccui
CCUI_CLUSTERS__0__AUTH_OIDC_CLIENT_SECRET=replace-me
CCUI_CLUSTERS__0__AUTH_OIDC_SCOPE=cruise-control/admin
```

This `oidc` is about how the server talks to Cruise Control. It has nothing to do with `CCUI_AUTH_MODE=oidc`, and the two can be used separately.

### When Cruise Control rejects the credentials

A 401 from Cruise Control is turned into a 502 with `{"error":"cluster rejected the service credentials"}`. The SPA treats 401 as "your session ended", and sending that to the user would log them out for a problem in the server's configuration.

## Forwarding the user identity

By default every user acts on Cruise Control with the cluster's service credentials. `AUTH_FORWARD_IDENTITY` changes that for one cluster. Cruise Control's own security has to be enabled for either value to mean anything.

| Value | What the server sends | Needs |
| --- | --- | --- |
| off (default) | The service credentials from `AUTH_TYPE`. | |
| `jwt` | The signed-in user's own ID token as `Authorization: Bearer <id_token>`, replacing the service credentials. | `CCUI_AUTH_MODE=oidc`. A user without a token (a local user, or `none` mode) gets 403 `no identity token available to forward; sign in with OIDC`. |
| `doas` | The service credentials, plus `doAs=<user name>` in the query. | Cruise Control must trust the service as a proxy. |

For `jwt`, set up Cruise Control's JWT security provider (`jwt.authentication.provider.url`, `jwt.auth.certificate.location`, `jwt.expected.audiences`) so that it accepts tokens from the same issuer and audience as the UI's OIDC client. The token is the one issued at sign-in and it is not renewed. When it expires, Cruise Control answers 401 and the user sees 502 `cluster rejected the service credentials` until they sign in again, even if the UI session (up to 12 hours) is still valid.

For `doas`, Cruise Control only honours `doAs` from its `TrustedProxySecurityProvider` and the services listed in `trusted.proxy.services`. That provider authenticates the proxy with SPNEGO, which this server cannot do, so `doas` is only useful when a gateway in front of Cruise Control accepts the service credentials and applies the trusted-proxy rules itself. The name sent is the one the UI shows: the local user name, the OIDC name, or `anonymous` in `none` mode.

## Cruise Control settings that matter

These are Cruise Control's own settings (`cruisecontrol.properties`), not the UI's.

| Setting | Why it matters here |
| --- | --- |
| `webserver.api.urlprefix` | Default `/kafkacruisecontrol/*`. The cluster `URL` must end with the prefix without `/*`. A wrong prefix shows up as 404 on every page. |
| `webserver.security.enable` and `webserver.security.provider` | Turn authentication on. With the default provider, `webserver.auth.credentials.file` lists `user: password,ROLE` lines and the roles are `VIEWER`, `USER` and `ADMIN`. Give the service account `ADMIN` when UI admins run operations. Without security the Config insights page says "Security is disabled on this cluster". |
| `two.step.verification.enabled` | When `true`, POSTs wait for approval and the Peer review page is used. When `false` (the Cruise Control default), `review_board` fails and the page explains it. See the [user guide](USER_GUIDE.md#peer-review). |
| `max.active.user.tasks` | Default 5, across all users of that Cruise Control. Asynchronous endpoints (`state`, `load`, `partition_load`, `proposals` and every operation that moves data) occupy one slot while they run. Raise it if several people use the UI on auto-refresh and you see `There are already 5 active user tasks`. |
| `webserver.request.maxBlockTimeMs` | How long Cruise Control works on a request before it answers 202 and continues in the background. The SPA follows the 202 until the result arrives. |
| `webserver.http.cors.enabled` | Leave it `false`. The browser never calls Cruise Control, so CORS is not needed. |

Cruise Control's VIEWER role only reaches `kafka_cluster_state`, `user_tasks` and `review_board`, which is not enough for the UI's own viewer role. If the service account has to be restricted, use the `USER` role and deploy the UI with viewers only.

## Replacing `config.csv` and the nginx

In the legacy setup each cluster needed a line in `config.csv` and a location in an nginx that proxied to Cruise Control. Here both go away: the cluster is a block of `CCUI_CLUSTERS__<n>__*` variables, and the proxy is built in. The [migration page](MIGRATION.md) maps one to the other line by line.
