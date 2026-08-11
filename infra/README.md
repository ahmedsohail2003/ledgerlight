# Deploying Ledgerlight to AWS

The app is **AWS-ready**: a production `Dockerfile` and Terraform for a real,
minimal, Free-Tier-minded deployment. It runs entirely locally today
(`docker-compose` for MySQL + `npm run api`); this directory is what makes it
one command to go live.

## Architecture

```
Internet ──HTTPS──► AWS App Runner (the container: Express API + React SPA)
                          │  VPC connector (private egress)
                          ▼
                    RDS MySQL 8.0 (private subnets, encrypted, not public)
                          ▲
        Secrets Manager ──┘  DB creds, JWT secret, Gemini key → runtime env
        ECR ── image source
```

Why App Runner over ECS/Fargate: fewer moving parts (no ALB/task defs to
hand-roll), HTTPS and autoscaling built in, and it still reaches a **private**
database through a VPC connector — the security posture that matters. Region
defaults to `ca-central-1` (Canadian data residency, fitting a Canadian
public-procurement tool).

## What only you can do (one-time, ~20 min)

Everything else is automated by `deploy.sh` / Terraform.

1. **Create an AWS account** and `aws configure` the CLI (access key, region).
2. **Set a budget alert** (Billing → Budgets) so there are no surprises.
3. **Export the Gemini key** for this shell: `export TF_VAR_gemini_api_key=...`
4. Have **Docker** and **Terraform ≥ 1.6** (or OpenTofu) installed.

Then: `./infra/deploy.sh`. It provisions ECR, builds and pushes the image,
stands up RDS + Secrets Manager + App Runner, and prints the public URL. After
first deploy, run the DB migrations + user seed against the new RDS endpoint,
and load data (`etl:official`, `rag:load`, `goldset:load`, `rules:run`).

## Cost (Free Tier / minimal)

| Resource | Cost |
|---|---|
| RDS `db.t4g.micro`, 20 GB gp3 | Free Tier 12 mo, then ~CAD $18/mo (stop when idle) |
| App Runner (1 vCPU / 2 GB) | ~CAD $5–7/mo active; pause to $0 |
| Secrets Manager | ~$0.40/secret/mo |
| ECR | pennies at this image size |

To keep a public demo near-zero and protect the API budget, cache the seeded
demo investigations so the public URL never calls Gemini on cold traffic (see
`SECURITY.md` G-7 and the deterministic fallback path).

## Validation status

- `Dockerfile`: multi-stage; the server build stage is exercised locally
  (`npm run build --workspace @ledgerlight/server` emits `dist/`).
- Terraform HCL parses clean. Full `terraform validate` (provider-schema
  check) and `plan` run in CI / on your machine, where the Terraform registry
  is reachable — it is blocked in the build sandbox this was authored in.
- `deploy.sh` is the intended path; review it before first run.

> This repository intentionally does **not** run a live public instance by
> default (cost + credentials are the owner's). The walkthrough assets in
> `docs/demo/` show the app running end-to-end; going live is the one command
> above whenever wanted.
