# Testing Guide — Phase 14: Kubernetes (local)

> How to run the whole stack on a **local Kubernetes cluster** using the
> manifests in [`k8s/`](../k8s) (Kustomize base + dev/prod overlays), and how to
> demo the things Kubernetes gives you that a PaaS hides: **self-healing**,
> **zero-downtime rolling updates**, and **autoscaling**.
>
> Prior guide: [`TESTING-PHASE-13-AI-INSIGHTS.md`](TESTING-PHASE-13-AI-INSIGHTS.md) · Deploy guide: [`DEPLOYMENT.md`](DEPLOYMENT.md)

---

## What's in `k8s/`

```
k8s/
├── base/                 # one self-contained stack
│   ├── namespace.yaml     enterprise namespace
│   ├── configmap.yaml     non-secret env (LOG_LEVEL, REDIS_HOST, ...)
│   ├── secret.yaml        dev-only secrets (DATABASE_URL, JWT, ...)
│   ├── postgres.yaml      StatefulSet + headless Service + PVC
│   ├── redis.yaml         StatefulSet + headless Service + PVC
│   ├── app.yaml           Deployment (2 replicas) + Service + migrate initContainer
│   ├── ingress.yaml       HTTP entry (needs ingress-nginx)
│   ├── hpa.yaml           HorizontalPodAutoscaler (needs metrics-server)
│   └── kustomization.yaml
└── overlays/
    ├── dev/               1 replica, debug logs
    └── prod/              3 replicas, roomier limits
```

Why the app drops onto Kubernetes so cleanly: it's **stateless**, configured **via env**, exposes **health endpoints** (liveness `/api/v1/health`, readiness `/api/v1/health/readiness` — the readiness check verifies Postgres + Redis), logs **structured JSON to stdout**, and **shuts down gracefully** on `SIGTERM` (so rolling updates drain in-flight requests). Migrations run **once** in an `initContainer` (`prisma migrate deploy`, which holds an advisory lock) rather than in the app's start command — the Deployment overrides the image `CMD` to just `node dist/main.js`.

---

## 0. Prerequisites

- **A local cluster.** Easiest: enable **Settings → Kubernetes → Enable Kubernetes** in Docker Desktop. Or install [kind](https://kind.sigs.k8s.io/) and `kind create cluster`.
- **kubectl** (`kubectl version --client`).
- Verify the cluster: `kubectl get nodes` → a `Ready` node.

Optional add-ons (only for the Ingress / HPA demos):
- **metrics-server** (for the HPA): `kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml` (on Docker Desktop/kind add `--kubelet-insecure-tls` to its args).
- **ingress-nginx** (for the Ingress): `kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml`.

---

## 1. Deploy the stack

```bash
# Validate locally first (no cluster needed):
kubectl kustomize k8s/base | less

# Apply everything (base = 2 API replicas):
kubectl apply -k k8s/base
# ...or the dev overlay (1 replica, debug logs):
kubectl apply -k k8s/overlays/dev

# Watch it come up:
kubectl -n enterprise get pods -w
```

You should see `postgres-0` and `redis-0` become Ready, the `migrate` initContainer run and complete, then the `nestjs-api` Pods go Ready.

```bash
kubectl -n enterprise get pods,svc,statefulset,deploy,hpa
```

---

## 2. Reach the API

```bash
kubectl -n enterprise port-forward svc/nestjs-api 8000:8000
```
Then open **http://localhost:8000/api/docs** and log in with the seeded admin (`admin@example.com` / `Admin123!ChangeMe`). Health: `curl localhost:8000/api/v1/health/readiness`.

**Via Ingress instead** (if you installed ingress-nginx): add `127.0.0.1  enterprise.local` to your hosts file, then browse **http://enterprise.local/api/docs**.

---

## 3. Demo: self-healing

```bash
# Kill a Pod — Kubernetes reschedules it automatically.
kubectl -n enterprise delete pod -l app.kubernetes.io/name=nestjs-api --wait=false
kubectl -n enterprise get pods -w      # a replacement appears within seconds
```

---

## 4. Demo: zero-downtime rolling update

```bash
# Trigger a rollout (e.g. pin a new image tag), then watch it roll:
kubectl -n enterprise set image deploy/nestjs-api \
  nestjs-api=ghcr.io/bhaskarreddygurram/nestjs-enterprise-starter:latest
kubectl -n enterprise rollout status deploy/nestjs-api
```
With `maxUnavailable: 0`, the old Pods only terminate once new ones pass readiness — and graceful shutdown drains their in-flight requests. Poll `/api/v1/health` in another terminal during the rollout: no failed requests.

---

## 5. Demo: autoscaling (the highlight)

Needs metrics-server (see prerequisites).

```bash
kubectl -n enterprise get hpa -w        # terminal 1
```
In terminal 2, drive load (reuse the k6 script from the load-test step, pointed at the port-forwarded `localhost:8000`, or a busy loop). As CPU crosses 70%, the HPA scales `nestjs-api` from 2 up toward 6 Pods; when load stops, it scales back down.

---

## 6. Overlays (Kustomize)

```bash
kubectl kustomize k8s/overlays/dev  | grep -E "replicas:|LOG_LEVEL:"   # 1 replica, debug
kubectl kustomize k8s/overlays/prod | grep -E "replicas:"             # 3 replicas
```
Same base, environment-specific patches — no templating language.

---

## 7. Cleanup

```bash
kubectl delete -k k8s/base
# PVCs (Postgres/Redis data) are kept by design; remove them explicitly:
kubectl -n enterprise delete pvc --all
# or drop everything:
kubectl delete namespace enterprise
```

---

## Notes / gotchas

- **secret.yaml holds dev-only values** (same throwaway creds as `.env.example`). For anything real, create the Secret out-of-band and drop it from the kustomization — see the header comment in the file.
- **In-cluster Postgres/Redis** is a self-contained *local* convenience. In production you'd point `DATABASE_URL` / `REDIS_URL` at managed services and delete `postgres.yaml` / `redis.yaml`.
- **metrics-server on Docker Desktop/kind** usually needs `--kubelet-insecure-tls`, otherwise the HPA shows `<unknown>` for CPU.
