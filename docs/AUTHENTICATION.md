# Authentication

`CCUI_AUTH_MODE` selects how people sign in. The mode applies to the whole server; you cannot mix local users and OIDC in one process.

| Mode | Who can sign in | Role comes from |
| --- | --- | --- |
| `none` | Nobody signs in. Every visitor is the user `anonymous`. | Always `admin`. |
| `local` | Users defined in environment variables, checked against a password hash. | `CCUI_LOCAL_USERS__<n>__ROLE`, or `admin` for the `CCUI_LOCAL_ADMIN_*` shortcut. |
| `oidc` | Users of one or more OpenID Connect providers. | The groups claim of the ID token. |

In `none` mode the server logs a warning at start. The CSRF and `Origin` checks still apply to every POST.

## Roles

| Role | Pages | Cruise Control endpoints |
| --- | --- | --- |
| `viewer` | Summary, Cluster state, Cruise Control state, Config insights, Load, Partition load | `kafka_cluster_state`, `state`, `load`, `partition_load`, `permissions` |
| `admin` | All pages, including Proposals, Admin, Peer review and User tasks | Everything the server forwards, see the [table in Security](SECURITY.md#role-gate-per-cruise-control-endpoint) |

The gate is on the server, not in the SPA. A viewer who types the address of the Admin page sees a "403 Forbidden" page, and a viewer who calls the API with curl gets 403 with `{"error":"your role does not allow this operation"}`. Any POST needs `admin`, whatever the endpoint is.

## Local users

### Generate a password hash

The server accepts bcrypt and argon2id. It rejects anything else, including plain text, at start.

=== "bcrypt with htpasswd"

    ```sh
    htpasswd -bnBC 12 "" 'your password' | tr -d ':\n'
    ```

    `htpasswd` prints `:<hash>` and a newline. The `tr` removes both. The result starts with `$2y$`, which the server accepts.

=== "bcrypt with Docker"

    ```sh
    docker run --rm httpd:2.4-alpine htpasswd -nbBC 12 "" 'your password' | tr -d ':\n'
    ```

=== "argon2id with Python"

    ```sh
    pip install argon2-cffi
    python3 -c "import getpass; from argon2 import PasswordHasher; print(PasswordHasher().hash(getpass.getpass()))"
    ```

    The password is read from the terminal, so it stays out of your shell history. The output looks like `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`.

Hashes contain `$`. Quote them in a shell, and read [Deployment](DEPLOYMENT.md#docker-compose) for the `$$` rule in Compose files. Putting the hash in a file and using `CCUI_LOCAL_ADMIN_PASSWORD_HASH_FILE` avoids both problems.

### One admin

```env
CCUI_AUTH_MODE=local
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_LOCAL_ADMIN_PASSWORD_HASH=$argon2id$v=19$m=65536,t=3,p=4$A2YFIt4+AWG4RTUB3P+HRw$CBC8dJpzhqCbItv8cHz1EZr73YxuUmUJvrp6YPa469A
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

The user is called `admin`. Add `CCUI_LOCAL_ADMIN_USER=ops` to rename it. The hash above belongs to the password `change this password`, so replace it.

### Several users

Number them from 0 and give each a role. The shortcut and numbered users can be combined as long as the names differ.

```env
CCUI_AUTH_MODE=local
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_LOCAL_ADMIN_USER=ops
CCUI_LOCAL_ADMIN_PASSWORD_HASH=$2a$10$jDy/91QpAa9CaSz6CQ1YX.uzTI0uNvUjh0c6H2P.2w8Zqa1433ism
CCUI_LOCAL_USERS__0__NAME=ana
CCUI_LOCAL_USERS__0__PASSWORD_HASH=$2a$10$jDy/91QpAa9CaSz6CQ1YX.uzTI0uNvUjh0c6H2P.2w8Zqa1433ism
CCUI_LOCAL_USERS__0__ROLE=viewer
CCUI_LOCAL_USERS__1__NAME=luis
CCUI_LOCAL_USERS__1__PASSWORD_HASH=$2a$10$jDy/91QpAa9CaSz6CQ1YX.uzTI0uNvUjh0c6H2P.2w8Zqa1433ism
CCUI_LOCAL_USERS__1__ROLE=admin
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

User names are compared exactly (case-sensitive) at login. Changing a password or adding a user needs a restart, and a restart ends every session.

### Failed logins

Failures are counted per client address and per user name (lowercased). After `CCUI_LOGIN_MAX_ATTEMPTS` failures (5) inside `CCUI_LOGIN_WINDOW` (15 minutes, counted from the first failure) the login answers 429 with `Retry-After` in seconds, even for the right password. A successful login clears the counter of that user name but not that of the address. The log gets a `login failed` warning with the address and never the user name. Where the address comes from, and what happens behind a proxy or `kubectl port-forward`, is in [Security](SECURITY.md#login-rate-limit).

## OIDC

The login uses the authorization code flow with PKCE (`S256`), `state` and `nonce`. The server discovers the provider on the first sign-in, not at start.

1. The SPA shows a "Sign in with `<name>`" button per provider. It links to `/api/auth/<name>/login`.
2. The server stores the flow in memory, sets a `ccui_oidc` cookie (HttpOnly, path `/api/auth/`, ten minutes) and redirects to the provider.
3. The provider redirects back to `<CCUI_PUBLIC_URL>/api/auth/<name>/callback`. The server checks the cookie against `state`, exchanges the code, verifies the ID token signature, audience and `nonce`, and maps the groups to a role.
4. It starts a session and redirects to `/`.

The redirect URL to register at the provider is therefore:

```text
<CCUI_PUBLIC_URL>/api/auth/<provider name>/callback
```

For `CCUI_PUBLIC_URL=https://cc.example.com` and a provider named `corp` that is `https://cc.example.com/api/auth/corp/callback`. Override it with `CCUI_OIDC__<n>__REDIRECT_URL` only when the provider needs another form.

### Mapping groups to roles

The server reads the claim named by `GROUPS_CLAIM` (default `groups`) from the ID token. An array of strings is used as is. A string is split on commas and spaces. Then:

1. A group in `ADMIN_GROUPS` gives `admin`.
2. Otherwise a group in `VIEWER_GROUPS` gives `viewer`. When a user matches both lists, admin wins.
3. Otherwise `DEFAULT_ROLE` applies. When it is empty the user gets 403 `your account has no role in this application` and no session.

Group names are compared exactly. Only the ID token is read; the userinfo endpoint is not called, so the groups have to be in the ID token itself.

### The user name

The name shown in the UI and written to the audit log is the first non-empty of the claims `preferred_username`, `email`, `name` and `sub`.

!!! warning
    A user whose name equals a configured local user is refused with 403 `this user name belongs to a local user`, and a warning with `"event":"oidc_login_refused"` is logged. This stops an identity-provider account called `admin` from taking over the local `admin`. Rename the local user, or the account, so the names differ.

Complete, copyable setups for each provider are in [Examples](EXAMPLES.md).

### Entra ID

Register an application, add a Web redirect URI `https://cc.example.com/api/auth/entra/callback`, and create a client secret. Under Token configuration add a groups claim for security groups. The token then carries group object IDs, not names.

```env
CCUI_AUTH_MODE=oidc
CCUI_PUBLIC_URL=https://cc.example.com
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_OIDC__0__NAME=entra
CCUI_OIDC__0__ISSUER=https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0
CCUI_OIDC__0__CLIENT_ID=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
CCUI_OIDC__0__CLIENT_SECRET=replace-me
CCUI_OIDC__0__ADMIN_GROUPS=9f8e7d6c-0000-1111-2222-333344445555
CCUI_OIDC__0__VIEWER_GROUPS=1a2b3c4d-0000-1111-2222-333344445555
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

Entra leaves the `groups` claim out of the token for users in more than 200 groups. If that can happen to your users, define app roles on the application, assign them to groups, and use the `roles` claim instead:

```env
CCUI_AUTH_MODE=oidc
CCUI_PUBLIC_URL=https://cc.example.com
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_OIDC__0__NAME=entra
CCUI_OIDC__0__ISSUER=https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0
CCUI_OIDC__0__CLIENT_ID=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
CCUI_OIDC__0__CLIENT_SECRET=replace-me
CCUI_OIDC__0__GROUPS_CLAIM=roles
CCUI_OIDC__0__ADMIN_GROUPS=ccui-admin
CCUI_OIDC__0__VIEWER_GROUPS=ccui-viewer
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

### Google

Create an OAuth client of type Web application with the authorized redirect URI `https://cc.example.com/api/auth/google/callback`. Google ID tokens carry no groups. Give everyone who may sign in the viewer role with `DEFAULT_ROLE`, and name the admins by e-mail address by pointing `GROUPS_CLAIM` at the `email` claim, which is a string and so counts as a one-element list.

```env
CCUI_AUTH_MODE=oidc
CCUI_PUBLIC_URL=https://cc.example.com
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_OIDC__0__NAME=google
CCUI_OIDC__0__ISSUER=https://accounts.google.com
CCUI_OIDC__0__CLIENT_ID=1234567890-abc.apps.googleusercontent.com
CCUI_OIDC__0__CLIENT_SECRET=replace-me
CCUI_OIDC__0__GROUPS_CLAIM=email
CCUI_OIDC__0__ADMIN_GROUPS=ana@example.com,luis@example.com
CCUI_OIDC__0__DEFAULT_ROLE=viewer
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

`DEFAULT_ROLE=viewer` lets in every Google account that completes the login, so limit who can reach the consent screen on the Google side (an internal OAuth app for a Workspace domain, for example).

### Amazon Cognito

Use an app client with a client secret, the authorization code grant, the scopes `openid`, `email` and `profile`, and the callback URL `https://cc.example.com/api/auth/cognito/callback`. Cognito puts user pool groups in the `cognito:groups` claim.

```env
CCUI_AUTH_MODE=oidc
CCUI_PUBLIC_URL=https://cc.example.com
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_OIDC__0__NAME=cognito
CCUI_OIDC__0__ISSUER=https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_AbCdEfGhI
CCUI_OIDC__0__CLIENT_ID=3n4b5v6c7x8z9a0s1d2f3g4h5j
CCUI_OIDC__0__CLIENT_SECRET=replace-me
CCUI_OIDC__0__GROUPS_CLAIM=cognito:groups
CCUI_OIDC__0__ADMIN_GROUPS=ccui-admins
CCUI_OIDC__0__VIEWER_GROUPS=ccui-viewers
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

### Keycloak

Create a confidential client with the standard flow and the valid redirect URI `https://cc.example.com/api/auth/keycloak/callback`. Add a "Group Membership" mapper to the client with token claim name `groups`, "Add to ID token" on and "Full group path" off. With the full path on, the values start with a slash (`/ccui-admins`) and have to be written that way in the lists.

```env
CCUI_AUTH_MODE=oidc
CCUI_PUBLIC_URL=https://cc.example.com
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_OIDC__0__NAME=keycloak
CCUI_OIDC__0__ISSUER=https://keycloak.example.com/realms/ops
CCUI_OIDC__0__CLIENT_ID=ccui
CCUI_OIDC__0__CLIENT_SECRET=replace-me
CCUI_OIDC__0__ADMIN_GROUPS=ccui-admins
CCUI_OIDC__0__VIEWER_GROUPS=ccui-viewers
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

### GitLab

gitlab.com and self-managed GitLab are OpenID Connect providers, so they work without a broker. Create a confidential application with the scopes `openid`, `profile` and `email` and the redirect URI `https://cc.example.com/api/auth/gitlab/callback`. GitLab puts the groups in the `groups_direct` claim of the ID token, as group paths, and only the groups the user is a direct member of.

```env
CCUI_AUTH_MODE=oidc
CCUI_PUBLIC_URL=https://cc.example.com
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_OIDC__0__NAME=gitlab
CCUI_OIDC__0__ISSUER=https://gitlab.com
CCUI_OIDC__0__CLIENT_ID=replace-me
CCUI_OIDC__0__CLIENT_SECRET=replace-me
CCUI_OIDC__0__GROUPS_CLAIM=groups_direct
CCUI_OIDC__0__ADMIN_GROUPS=my-org/platform
CCUI_OIDC__0__VIEWER_GROUPS=my-org
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

For a self-managed instance use its base URL as `ISSUER`. The step-by-step setup and the direct-membership caveat are in [Examples](EXAMPLES.md#gitlab).

### Any other provider

Anything that publishes `/.well-known/openid-configuration` and puts the groups in the ID token works the same way: set `NAME`, `ISSUER`, `CLIENT_ID`, `CLIENT_SECRET`, register the redirect URL, and choose the claim and the groups. If the provider needs a scope to release the groups, add it to `SCOPES`, for example `openid profile email groups`.

You can configure more than one provider. The login page shows one button each, and the names must be unique.

```env
CCUI_AUTH_MODE=oidc
CCUI_PUBLIC_URL=https://cc.example.com
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_OIDC__0__NAME=corp
CCUI_OIDC__0__ISSUER=https://keycloak.example.com/realms/ops
CCUI_OIDC__0__CLIENT_ID=ccui
CCUI_OIDC__0__CLIENT_SECRET=replace-me
CCUI_OIDC__0__ADMIN_GROUPS=ccui-admins
CCUI_OIDC__1__NAME=partners
CCUI_OIDC__1__ISSUER=https://login.partner.example.com
CCUI_OIDC__1__CLIENT_ID=ccui
CCUI_OIDC__1__CLIENT_SECRET=replace-me
CCUI_OIDC__1__SCOPES=openid profile email groups
CCUI_OIDC__1__DEFAULT_ROLE=viewer
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

### GitHub

GitHub is an OAuth 2.0 provider without OIDC discovery or ID tokens, so it cannot be used directly. Put an OIDC broker in front of it. With [Dex](https://dexidp.io), add GitHub as a connector and this server as a static client:

```yaml
issuer: https://dex.example.com
connectors:
  - type: github
    id: github
    name: GitHub
    config:
      clientID: <GitHub OAuth app client id>
      clientSecret: <GitHub OAuth app client secret>
      redirectURI: https://dex.example.com/callback
      orgs:
        - name: my-org
staticClients:
  - id: ccui
    name: Cruise Control UI
    secret: replace-me
    redirectURIs:
      - https://cc.example.com/api/auth/dex/callback
```

Then point the server at Dex and ask for the `groups` scope. Look at a real ID token to see what Dex puts in the claim for your organisation and teams (organisation names, or `org:team` pairs) and use exactly those strings.

```env
CCUI_AUTH_MODE=oidc
CCUI_PUBLIC_URL=https://cc.example.com
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_OIDC__0__NAME=dex
CCUI_OIDC__0__ISSUER=https://dex.example.com
CCUI_OIDC__0__CLIENT_ID=ccui
CCUI_OIDC__0__CLIENT_SECRET=replace-me
CCUI_OIDC__0__SCOPES=openid profile email groups
CCUI_OIDC__0__ADMIN_GROUPS=my-org:platform
CCUI_OIDC__0__VIEWER_GROUPS=my-org
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

A Keycloak realm with GitHub as an identity provider does the same job.

## Sessions

A session is a random 256-bit identifier held in the server's memory, sent in a cookie called `ccui_session`.

| Property | Value |
| --- | --- |
| Cookie flags | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` unless `CCUI_COOKIE_INSECURE=true` |
| Cookie `Max-Age` | `CCUI_SESSION_MAX_AGE` (12h) |
| Idle timeout | `CCUI_SESSION_IDLE_TIMEOUT` (30m). Every request that carries the cookie, including the SPA's auto-refresh, counts as activity. |
| Hard limit | `CCUI_SESSION_MAX_AGE` after login. Activity does not extend it. |
| End of a session | Sign out, either timeout, or a restart of the process. |
| Storage | Memory of one process. Nothing is written to disk. |

When a session ends the next API call answers 401 and the SPA goes back to the login page. After a local login the page you were on is shown again. After an OIDC login you land on Summary. A role change at the identity provider, or a group removal, takes effect at the next login, not in a running session.

With more than one replica, a user has to reach the same replica every time. See [session affinity](DEPLOYMENT.md#several-replicas).
