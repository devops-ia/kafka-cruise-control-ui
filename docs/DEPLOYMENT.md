# Installation and deployment

The image is `ghcr.io/devops-ia/kafka-cruise-control-ui`. It is built from distroless, runs as user 65532 and listens on port 8080. It has no shell, writes nothing to disk, and works with a read-only root filesystem. Keep `CCUI_LISTEN` above port 1023 because the user is not root.

## Docker

```sh
docker run -d --name ccui --read-only -p 8080:8080 \
  --env-file ccui.env \
  ghcr.io/devops-ia/kafka-cruise-control-ui
```

`ccui.env` holds the `KEY=value` lines from [Configuration](CONFIGURATION.md). `docker run --env-file` takes values literally, so a bcrypt hash with `$` characters works as written, without quotes.

The image declares `HEALTHCHECK CMD ["/server", "-healthcheck"]`, which requests `/healthz` on the port of `CCUI_LISTEN` every 30 seconds. With TLS on it probes `https://127.0.0.1` without verifying the certificate, because that certificate is usually issued for the public name.

## Docker Compose

Compose reads `$` in values as the start of a variable. A bcrypt hash written inline needs every `$` doubled. Passing secrets as files avoids that, and keeps them out of `docker inspect`.

```yaml
services:
  ccui:
    image: ghcr.io/devops-ia/kafka-cruise-control-ui
    read_only: true
    ports:
      - "8080:8080"
    environment:
      CCUI_AUTH_MODE: local
      CCUI_COOKIE_INSECURE: "true" # remove when you put HTTPS in front
      CCUI_SESSION_SECRET_FILE: /run/secrets/ccui_session_secret
      CCUI_LOCAL_ADMIN_PASSWORD_HASH_FILE: /run/secrets/ccui_admin_hash
      CCUI_CLUSTERS__0__NAME: prod
      CCUI_CLUSTERS__0__URL: http://cruise-control:9090/kafkacruisecontrol
    secrets:
      - ccui_session_secret
      - ccui_admin_hash
    depends_on:
      - cruise-control
    restart: unless-stopped

secrets:
  ccui_session_secret:
    file: ./secrets/session_secret
  ccui_admin_hash:
    file: ./secrets/admin_hash
```

Create the two files before `docker compose up`. The container user is 65532, so the files must be readable by others (mode 0644).

```sh
mkdir -p secrets
openssl rand -base64 48 | tr -d '\n' > secrets/session_secret
htpasswd -bnBC 12 "" 'your password' | tr -d ':\n' > secrets/admin_hash
chmod 644 secrets/*
```

## Kubernetes

The manifest below runs one replica with the hash and the session secret in a Secret. The Secret is read through `secretKeyRef` into environment variables, so Kubernetes does not touch the `$` in the hash.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: kafka-cruise-control-ui
type: Opaque
stringData:
  session-secret: replace-with-the-output-of-openssl-rand-base64-48-xxxxxxxx
  admin-hash: "$2a$10$jDy/91QpAa9CaSz6CQ1YX.uzTI0uNvUjh0c6H2P.2w8Zqa1433ism"
  cc-prod-password: replace-me
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kafka-cruise-control-ui
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kafka-cruise-control-ui
  template:
    metadata:
      labels:
        app: kafka-cruise-control-ui
    spec:
      enableServiceLinks: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: ui
          image: ghcr.io/devops-ia/kafka-cruise-control-ui:latest
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: CCUI_AUTH_MODE
              value: local
            - name: CCUI_PUBLIC_URL
              value: https://cc.example.com
            - name: CCUI_TRUST_XFF
              value: "true"
            - name: CCUI_SESSION_SECRET
              valueFrom:
                secretKeyRef:
                  name: kafka-cruise-control-ui
                  key: session-secret
            - name: CCUI_LOCAL_ADMIN_PASSWORD_HASH
              valueFrom:
                secretKeyRef:
                  name: kafka-cruise-control-ui
                  key: admin-hash
            - name: CCUI_CLUSTERS__0__NAME
              value: prod
            - name: CCUI_CLUSTERS__0__URL
              value: http://cruise-control.kafka.svc:9090/kafkacruisecontrol
            - name: CCUI_CLUSTERS__0__AUTH_TYPE
              value: basic
            - name: CCUI_CLUSTERS__0__AUTH_USER
              value: ccui
            - name: CCUI_CLUSTERS__0__AUTH_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: kafka-cruise-control-ui
                  key: cc-prod-password
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
          resources:
            requests:
              cpu: 10m
              memory: 32Mi
            limits:
              memory: 128Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: [ALL]
---
apiVersion: v1
kind: Service
metadata:
  name: kafka-cruise-control-ui
spec:
  selector:
    app: kafka-cruise-control-ui
  ports:
    - name: http
      port: 80
      targetPort: http
```

`enableServiceLinks: false` matters. Kubernetes injects `<SERVICE>_SERVICE_HOST` and similar variables for every Service in the namespace, and the server rejects any `CCUI_*` variable it does not know. A Service called `ccui` would produce `CCUI_SERVICE_HOST` and the pod would not start. See [Troubleshooting](TROUBLESHOOTING.md#startup-fails-with-unknown-variable).

The requests and limits are a starting point, not a recommendation. See [resource sizing](#resource-sizing).

### With the helm-cruise-control chart

The [`devops-ia/helm-cruise-control`](https://github.com/devops-ia/helm-cruise-control) chart has a `ui` block with `env`, `envFromSecrets`, `envFromFiles`, `ingress` and probes. Put the secrets in a Secret you create, and load it with `envFromFiles` (an `envFrom` list).

```yaml
ui:
  enabled: true
  image:
    repository: ghcr.io/devops-ia/kafka-cruise-control-ui
    tag: <released version of this image>
  env:
    CCUI_AUTH_MODE: local
    CCUI_PUBLIC_URL: https://cc.example.com
    CCUI_TRUST_XFF: "true"
    CCUI_CLUSTERS__0__NAME: prod
    CCUI_CLUSTERS__0__URL: http://cruise-control-prod.kafka.svc/kafkacruisecontrol
  envFromFiles:
    - secretRef:
        name: ccui-secrets # holds CCUI_SESSION_SECRET and CCUI_LOCAL_ADMIN_PASSWORD_HASH
  livenessProbeCustom:
    httpGet:
      path: /healthz
      port: http
  readinessProbeCustom:
    httpGet:
      path: /readyz
      port: http
```

Create the Secret with the variable names as keys:

```sh
kubectl -n kafka create secret generic ccui-secrets \
  --from-literal=CCUI_SESSION_SECRET="$(openssl rand -base64 48)" \
  --from-literal=CCUI_LOCAL_ADMIN_PASSWORD_HASH="$(htpasswd -bnBC 12 "" 'your password' | tr -d ':\n')"
```

Three details of the chart that matter with this image:

- The cluster Service is named `<release>-<cluster key>` and listens on port 80 by default, so a release called `cruise-control` with the cluster key `prod` is `http://cruise-control-prod.kafka.svc/kafkacruisecontrol`. Check with `kubectl get svc`.
- The chart's built-in probes request `/health`, which this server does not serve. Use the `*Custom` probes as above.
- When both `ui.env` and `ui.envFromSecrets` are set, the deployment template renders an `env:` key twice. Using `envFromFiles` for secrets, as above, avoids it.

## TLS

Two ways, and the second is the usual one.

**Terminate TLS in the server.** Mount a certificate and key and set both variables. The server then serves HTTPS with TLS 1.2 or newer and sends `Strict-Transport-Security: max-age=63072000; includeSubDomains`. It reads the files once at start, so a renewed certificate needs a restart.

```sh
docker run -d -p 8443:8080 --read-only \
  -v "$PWD/tls:/tls:ro" \
  -e CCUI_TLS_CERT=/tls/tls.crt \
  -e CCUI_TLS_KEY=/tls/tls.key \
  --env-file ccui.env \
  ghcr.io/devops-ia/kafka-cruise-control-ui
```

**Terminate TLS in front of it.** Run the server on plain HTTP behind an ingress, load balancer or reverse proxy. The server does not send HSTS in that case, so add the header at the proxy.

## Behind an ingress or reverse proxy

Set these two on the server:

| Variable | Why |
| --- | --- |
| `CCUI_PUBLIC_URL=https://cc.example.com` | State-changing requests must carry an `Origin` equal to this value. Without it the server compares `Origin` with the `Host` header it receives, which breaks when the proxy rewrites `Host`. Required with OIDC, where it also builds the callback URL. |
| `CCUI_TRUST_XFF=true` | Takes the client address from the last `X-Forwarded-For` entry for the login rate limit and the log. Without it, every user shares the proxy's address and five wrong passwords lock everybody out. |

Only enable `CCUI_TRUST_XFF` when the proxy appends the address and the server cannot be reached around it. A client that can talk to the server directly could otherwise pick its own address.

An nginx ingress example:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kafka-cruise-control-ui
  annotations:
    nginx.ingress.kubernetes.io/affinity: cookie
    nginx.ingress.kubernetes.io/configuration-snippet: |
      add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
spec:
  ingressClassName: nginx
  tls:
    - hosts: [cc.example.com]
      secretName: cc-example-com-tls
  rules:
    - host: cc.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: kafka-cruise-control-ui
                port:
                  name: http
```

The `configuration-snippet` annotation is disabled by default in recent ingress-nginx releases. If yours rejects it, set HSTS in the controller's ConfigMap instead.

The UI is served from the root of its host. It cannot be mounted under a path such as `/ui`.

## Several replicas

Sessions, the login rate limit and OIDC logins in progress live in the memory of each process. With more than one replica, a user must always reach the same one, or the next request answers 401 and the SPA shows the login page. An OIDC callback that lands on a different replica than the redirect fails with `invalid login state, start again`.

Use cookie affinity at the ingress (`nginx.ingress.kubernetes.io/affinity: cookie` above), or `sessionAffinity: ClientIP` on the Service when clients keep their address. Give every replica the same `CCUI_SESSION_SECRET`. A rolling update or restart still ends the sessions on the replicas that are replaced.

One replica is usually enough. The process is small, and Cruise Control is the part that does the work.

## Health endpoints

| Path | Answer | Authentication |
| --- | --- | --- |
| `GET /healthz` | `200 ok` as long as the process serves requests | none |
| `GET /readyz` | `200 ok`, same condition | none |

Neither checks Cruise Control, so a cluster that is down does not take the UI out of rotation. The SPA shows that per cluster instead. Neither reveals configuration.

## Shutdown

On `SIGTERM` or `SIGINT` the server stops accepting connections and waits up to 10 seconds for requests in flight. Requests to Cruise Control are bounded by the cluster `TIMEOUT`, so a long request can be cut off by a pod's termination grace period.

## Resource sizing

What was measured:

| Item | Value |
| --- | --- |
| Image size | 11.9 MB |
| Resident memory of the binary, right after start with one cluster | 13 to 15 MB (`ps -o rss`, macOS arm64, not a container) |

The server holds sessions, rate-limit counters and OIDC flows in memory, and streams Cruise Control responses without buffering them, except that SigV4 clusters buffer the request body to sign it. Expect memory to stay in the tens of megabytes. The requests and limits in the manifest above (10m CPU, 32Mi request, 128Mi limit) leave room and come from those numbers, not from a load test. Check your own usage with `kubectl top pod` after a week.

## Legacy UI

The LinkedIn `cruise-control-ui` is frozen. Nothing builds or publishes it any more; the `helm-cruise-control` chart still deploys the images that already exist:

- `ghcr.io/devops-ia/kafka-cruise-control-ui:0.4.0`
- `devopsiaci/cruise-control-ui:0.4.0`

To build it yourself, use the `legacy` target of this repository's Dockerfile. It is a local build only. CI does not touch it, and a plain `docker build .` still gives the normal image.

```sh
docker build --target legacy -t cruise-control-ui-legacy .
docker run --name ccui-legacy -p 8081:80 \
  -v $(pwd)/config.csv:/usr/share/nginx/html/static/config.csv:ro \
  cruise-control-ui-legacy
```

The `-v` line is optional. The image ships a `config.csv` with a single line, `local,local,/kafkacruisecontrol/`. A line is `<group>,<name>,<nginx path>`: the browser calls the nginx path, so your nginx has to proxy it to Cruise Control. The default nginx configuration in the image does not.

The release comes from the `CC_UI_TAG` build argument (default `0.4.0`). The container runs nginx as user 101 and listens on port 80.

The legacy UI has no login and no roles. Anyone who can reach it can run every operation, so do not expose it without another layer of protection. To move to the current UI, see [Migration from the legacy UI](MIGRATION.md).

## Documentation site

This site is published by the `Pages` workflow on every push to `main`. In the repository, Settings > Pages > Source must be GitHub Actions. With "Deploy from a branch", GitHub publishes the README through Jekyll and overwrites this site.
