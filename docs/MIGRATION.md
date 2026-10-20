# Migration from the legacy UI

This page is for deployments of the LinkedIn `cruise-control-ui`, as packaged in the `devops-ia` images and the `helm-cruise-control` chart: a static site served by nginx, a `config.csv` that lists the clusters, and an nginx location per cluster that proxies to Cruise Control.

## What changes

| Legacy | This UI |
| --- | --- |
| Static files in nginx. The browser calls Cruise Control through nginx. | A Go server. The browser calls only the server, which calls Cruise Control. |
| `config.csv` in the web root, read by the browser. | `CCUI_CLUSTERS__<n>__*` environment variables, read by the server at start. |
| An nginx location and upstream per cluster. | Built in. No nginx. |
| No login in the UI. | `none`, `local` or `oidc`, with roles `viewer` and `admin`. |
| Cruise Control credentials are not handled by the UI itself. | Kept on the server, with `basic`, `bearer`, `sigv4` or OAuth2 client credentials. |

## Cluster list

A `config.csv` line is `<group>,<cluster-name>,<url>`. The URL there is an nginx path such as `/cluster-prod/kafkacruisecontrol/`, not the Cruise Control address. In the new setup you give the real address, and the group and name map one to one.

```csv
develop,cluster-dev,/cluster-dev/kafkacruisecontrol/
cluster,cluster-prod,/cluster-prod/kafkacruisecontrol/
```

with nginx upstreams `cc-cluster-dev` and `cc-cluster-prod` pointing at the two Cruise Control services, becomes:

```env
CCUI_AUTH_MODE=none
CCUI_CLUSTERS__0__GROUP=develop
CCUI_CLUSTERS__0__NAME=cluster-dev
CCUI_CLUSTERS__0__URL=http://cruise-control-cluster-dev.kafka.svc/kafkacruisecontrol
CCUI_CLUSTERS__1__GROUP=cluster
CCUI_CLUSTERS__1__NAME=cluster-prod
CCUI_CLUSTERS__1__URL=http://cruise-control-cluster-prod.kafka.svc/kafkacruisecontrol
```

Steps:

1. Write one block per `config.csv` line. Column 1 is `GROUP`, column 2 is `NAME`, and `URL` is the address of the Cruise Control service that your nginx upstream pointed to, followed by its API prefix. Cluster names may use letters, digits, `.`, `_` and `-`.
2. Choose how people sign in. `none` reproduces the old behaviour of an open UI and makes every visitor an admin, so use it only on a closed network. For anything else use `local` or `oidc` ([Authentication](AUTHENTICATION.md)).
3. If your nginx added credentials when it proxied to Cruise Control, move them into `AUTH_TYPE` and the matching variables of each cluster ([Clusters](CLUSTERS.md#authenticating-to-cruise-control)).
4. Remove the nginx and the `config.csv` mount. The new image listens on port 8080 instead of 80 and has no static `config.csv`.
5. Check the Cruise Control side ([settings that matter](CLUSTERS.md#cruise-control-settings-that-matter)), especially `webserver.api.urlprefix` and `max.active.user.tasks`.

## Docker

Legacy:

```sh
docker run --name cruise-control-ui -p 8080:80 \
  -v $(pwd)/config.csv:/usr/share/nginx/html/static/config.csv:ro \
  devopsiaci/cruise-control-ui:0.4.0
```

New:

```sh
docker run --name cruise-control-ui -p 8080:8080 --env-file ccui.env \
  ghcr.io/devops-ia/kafka-cruise-control-ui
```

## Helm

The `helm-cruise-control` chart renders `config.csv` and an nginx configuration from the `clusters` of its values for its `ui` block. For this UI, set `ui.image` to this image and move the cluster list into `ui.env`, as in the [Kubernetes example](DEPLOYMENT.md#with-the-helm-cruise-control-chart). The `clusters` values still define the Cruise Control deployments themselves.

## Legacy UI

If you cannot move yet, the legacy images stay available and frozen at `0.4.0`: `ghcr.io/devops-ia/kafka-cruise-control-ui:0.4.0` and `devopsiaci/cruise-control-ui:0.4.0`. Nothing builds or publishes them any more. Build it locally from this repository with:

```sh
docker build --target legacy -t cruise-control-ui-legacy .
docker run --name ccui-legacy -p 8081:80 \
  -v $(pwd)/config.csv:/usr/share/nginx/html/static/config.csv:ro \
  cruise-control-ui-legacy
```

It reads `config.csv` with lines of `<group>,<name>,<nginx path>`, for example `local,local,/kafkacruisecontrol/`. It has no login and no roles. More in [Installation and deployment](DEPLOYMENT.md#legacy-ui).

## Things to know in the new UI

- There is no way to add a cluster from the browser. Clusters are changed in the configuration and need a restart.
- Operations that change the cluster have separate Simulate and Execute buttons. Execute asks for a confirmation ([user guide](USER_GUIDE.md#simulate-and-execute)).
- Pages that need `admin` are hidden from viewers, and the server enforces it.
- Asynchronous operations are followed in a panel that stays visible while you move between pages.
