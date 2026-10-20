# Configuration examples

Each example is a complete set of variables that starts the server. Copy one into an env file, replace the values that say `replace-me` or use `example.com`, and run it as shown in [Deployment](DEPLOYMENT.md). The variables themselves are described in [Configuration](CONFIGURATION.md).

Pick the first one that matches what you want:

| You want | Example |
| --- | --- |
| Look at the UI on your laptop, no sign-in | [No login](#no-login-on-a-laptop) |
| One shared password | [One local admin](#one-local-admin) |
| A small team, no identity provider | [Local users with roles](#local-users-with-roles) |
| Sign in with GitLab | [GitLab](#gitlab) |
| Sign in with GitHub | [GitHub through Dex](#github-through-dex) |
| Sign in with a Microsoft work account | [Microsoft Entra ID](#microsoft-entra-id) |
| Two identity providers at once | [Several providers](#several-providers) |
| Several Kafka clusters | [Several clusters](#several-clusters) |
| Secrets from files, as on Kubernetes | [Secrets as files](#secrets-as-files) |

## No login on a laptop

```env
CCUI_AUTH_MODE=none
CCUI_CLUSTERS__0__NAME=local
CCUI_CLUSTERS__0__URL=http://localhost:9090/kafkacruisecontrol
```

Nobody signs in and everybody is `admin`. The server prints a warning at start. This is only for a machine nobody else can reach, so publish the port on the loopback address only:

```sh
docker run --rm --read-only -p 127.0.0.1:8080:8080 --env-file ccui.env \
  ghcr.io/devops-ia/kafka-cruise-control-ui
```

Inside Docker, `localhost` is the container. To reach a Cruise Control on your host use `host.docker.internal` (Docker Desktop and OrbStack) as the host name.

## One local admin

```env
CCUI_AUTH_MODE=local
CCUI_COOKIE_INSECURE=true
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_LOCAL_ADMIN_PASSWORD_HASH=$2a$10$jDy/91QpAa9CaSz6CQ1YX.uzTI0uNvUjh0c6H2P.2w8Zqa1433ism
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

The user is `admin`. The hash above is for the password `change this password`; make your own with the commands in [Authentication](AUTHENTICATION.md#generate-a-password-hash). Generate the session secret with `openssl rand -base64 32`.

`CCUI_COOKIE_INSECURE=true` is there so the login works over plain HTTP while you try it. Remove it as soon as the UI is behind HTTPS, otherwise the session cookie travels without the `Secure` flag.

## Local users with roles

```env
CCUI_AUTH_MODE=local
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_LOCAL_USERS__0__NAME=ana
CCUI_LOCAL_USERS__0__PASSWORD_HASH=$2a$10$jDy/91QpAa9CaSz6CQ1YX.uzTI0uNvUjh0c6H2P.2w8Zqa1433ism
CCUI_LOCAL_USERS__0__ROLE=viewer
CCUI_LOCAL_USERS__1__NAME=luis
CCUI_LOCAL_USERS__1__PASSWORD_HASH=$2a$10$jDy/91QpAa9CaSz6CQ1YX.uzTI0uNvUjh0c6H2P.2w8Zqa1433ism
CCUI_LOCAL_USERS__1__ROLE=admin
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

`ana` can read the dashboards (Summary, Cluster state, Load) and nothing else. `luis` can also run proposals, rebalance, change the executor and use the Admin page. The role is enforced by the server, so hiding a menu entry is not what keeps `ana` out. A new user or a new password needs a restart.

## GitLab

This works with gitlab.com and with a self-managed GitLab. GitLab is a real OpenID Connect provider, so no broker is needed.

1. In GitLab go to **Edit profile > Applications** (or **Admin > Applications** for the whole instance, or a group's **Settings > Applications**) and add an application.
2. Set the redirect URI to `https://cc.example.com/api/auth/gitlab/callback`. The `gitlab` in the path is the provider name you set in `CCUI_OIDC__0__NAME` below.
3. Tick **Confidential** and the scopes `openid`, `profile` and `email`.
4. Copy the application ID and the secret.

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

For a self-managed instance set `CCUI_OIDC__0__ISSUER` to its base URL, for example `https://gitlab.example.com`. The server reads `<issuer>/.well-known/openid-configuration` on the first sign-in.

GitLab puts the groups in the `groups_direct` claim of the ID token, as group paths such as `my-org/platform`. Two things catch people out:

- The claim lists only the groups the user is a **direct** member of. Someone who belongs to `my-org/platform` but not to `my-org` itself does not match `VIEWER_GROUPS=my-org`. Put every path you care about in the lists.
- The plain `groups` claim and the `https://gitlab.org/claims/groups/*` claims are not in the ID token (GitLab returns them only from the userinfo endpoint, which this server does not call), so `GROUPS_CLAIM` has to be `groups_direct`.

A user who matches neither list gets a 403 `your account has no role in this application`. Add `CCUI_OIDC__0__DEFAULT_ROLE=viewer` if every GitLab user of the instance should see the dashboards.

## GitHub through Dex

GitHub does not publish OIDC discovery and issues no ID tokens, so the server cannot talk to it directly. [Dex](https://dexidp.io) sits in between: it speaks OAuth 2.0 to GitHub and OIDC to this server. The Dex side is in [Authentication](AUTHENTICATION.md#github). The server side is:

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

The three places that have to agree are easy to mix up:

| Where | Value |
| --- | --- |
| GitHub OAuth app, callback URL | `https://dex.example.com/callback` |
| Dex `staticClients[].redirectURIs` | `https://cc.example.com/api/auth/dex/callback` |
| This server, `CCUI_OIDC__0__NAME` | `dex` (it is the `dex` in the line above) |

Decode a real ID token once (paste it into any JWT viewer) to see what Dex puts in `groups` for your organisation and teams, and write exactly those strings in the lists.

## Microsoft Entra ID

Register an application, add the Web redirect URI `https://cc.example.com/api/auth/entra/callback` and create a client secret. Then choose how the roles reach the token.

**Option 1, security groups.** Add a groups claim under **Token configuration**. The token carries group object IDs, so those are what you write in the lists.

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

**Option 2, app roles.** Entra drops the `groups` claim for users in more than 200 groups. Define the app roles `ccui-admin` and `ccui-viewer` on the application, assign them to groups, and read the `roles` claim:

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

Option 2 keeps working for users in many groups, so prefer it in a large tenant. The value after `/` in the issuer is your tenant ID, not the application ID.

## Several providers

The login page shows one button per provider. Here engineers sign in with GitLab and a contractor company with Entra, where everybody from the contractor is a viewer:

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
CCUI_OIDC__1__NAME=contractor
CCUI_OIDC__1__ISSUER=https://login.microsoftonline.com/66666666-7777-8888-9999-000000000000/v2.0
CCUI_OIDC__1__CLIENT_ID=bbbbbbbb-cccc-dddd-eeee-ffffffffffff
CCUI_OIDC__1__CLIENT_SECRET=replace-me
CCUI_OIDC__1__DEFAULT_ROLE=viewer
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
```

Register one redirect URI at each provider, and note that the path carries the provider name: `/api/auth/gitlab/callback` and `/api/auth/contractor/callback`. `DEFAULT_ROLE=viewer` on the contractor tenant lets in anybody who can sign in to it, so assign users to the application on the Entra side.

## Several clusters

```env
CCUI_AUTH_MODE=local
CCUI_SESSION_SECRET=replace-with-at-least-32-random-characters
CCUI_LOCAL_ADMIN_PASSWORD_HASH=$2a$10$jDy/91QpAa9CaSz6CQ1YX.uzTI0uNvUjh0c6H2P.2w8Zqa1433ism
CCUI_CLUSTERS__0__NAME=dev
CCUI_CLUSTERS__0__GROUP=Development
CCUI_CLUSTERS__0__URL=http://cc.dev.svc:9090/kafkacruisecontrol
CCUI_CLUSTERS__1__NAME=prod-eu
CCUI_CLUSTERS__1__GROUP=Production
CCUI_CLUSTERS__1__URL=https://cc-eu.example.com/kafkacruisecontrol
CCUI_CLUSTERS__1__AUTH_TYPE=basic
CCUI_CLUSTERS__1__AUTH_USER=ccui
CCUI_CLUSTERS__1__AUTH_PASSWORD=replace-me
CCUI_CLUSTERS__2__NAME=prod-us
CCUI_CLUSTERS__2__GROUP=Production
CCUI_CLUSTERS__2__URL=https://cc-us.example.com/kafkacruisecontrol
CCUI_CLUSTERS__2__AUTH_TYPE=bearer
CCUI_CLUSTERS__2__AUTH_TOKEN=replace-me
CCUI_CLUSTERS__2__TIMEOUT=120s
```

Each cluster has its own address and its own way of authenticating to Cruise Control. `dev` has none, `prod-eu` uses basic auth, and `prod-us` sends a bearer token and gets a longer timeout. The selector in the top bar groups them as Development and Production. The credentials belong to the server, so a user who signs in to the UI never sees or needs them. The other methods (`sigv4` for an API gateway on AWS, `oidc` client credentials) and identity forwarding are in [Clusters](CLUSTERS.md).

## Secrets as files

Mounted secrets keep values out of the environment and out of `docker inspect`. Every secret variable has a `_FILE` twin, and the value is the path to read:

```env
CCUI_AUTH_MODE=oidc
CCUI_PUBLIC_URL=https://cc.example.com
CCUI_SESSION_SECRET_FILE=/run/secrets/session-secret
CCUI_OIDC__0__NAME=gitlab
CCUI_OIDC__0__ISSUER=https://gitlab.com
CCUI_OIDC__0__CLIENT_ID=replace-me
CCUI_OIDC__0__CLIENT_SECRET_FILE=/run/secrets/gitlab-client-secret
CCUI_OIDC__0__GROUPS_CLAIM=groups_direct
CCUI_OIDC__0__ADMIN_GROUPS=my-org/platform
CCUI_CLUSTERS__0__NAME=prod
CCUI_CLUSTERS__0__URL=http://cc.kafka.svc:9090/kafkacruisecontrol
CCUI_CLUSTERS__0__AUTH_TYPE=basic
CCUI_CLUSTERS__0__AUTH_USER=ccui
CCUI_CLUSTERS__0__AUTH_PASSWORD_FILE=/run/secrets/cc-prod-password
```

On Kubernetes that means a Secret mounted as files. Do not set both `CCUI_X` and `CCUI_X_FILE` for the same variable.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: ccui-secrets
type: Opaque
stringData:
  session-secret: replace-with-at-least-32-random-characters
  gitlab-client-secret: replace-me
  cc-prod-password: replace-me
---
# In the Deployment's pod spec:
#   volumes:
#     - name: secrets
#       secret:
#         secretName: ccui-secrets
#   containers:
#     - name: ccui
#       volumeMounts:
#         - { name: secrets, mountPath: /run/secrets, readOnly: true }
```

The full Deployment, probes and ingress are in [Deployment](DEPLOYMENT.md#kubernetes).

## Checking a configuration

The server validates every variable at start and exits with status 1, naming each wrong one. A typo in a `CCUI_*` name is an error too, so a misspelled security setting cannot be ignored without you noticing. OIDC discovery is lazy: the server starts even if the provider is down or the issuer is wrong, and the mistake shows up when the first person clicks "Sign in". If that click ends in an error, the server log has the reason. See [Troubleshooting](TROUBLESHOOTING.md).
