#!/usr/bin/env bash
# One-command AWS deploy. Prereqs (one-time, yours): an AWS account, the AWS
# CLI configured (aws configure), Docker, and Terraform/OpenTofu installed.
# Provide the Gemini key via env: export TF_VAR_gemini_api_key=...
set -euo pipefail

REGION="${AWS_REGION:-ca-central-1}"
APP="ledgerlight"
TF_DIR="$(cd "$(dirname "$0")/terraform" && pwd)"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${APP}"

echo "==> 1/5 ensure ECR repo (via terraform, image URI known up front)"
cd "$TF_DIR"
terraform init -input=false
terraform apply -input=false -auto-approve -target=aws_ecr_repository.app \
  -var="container_image=${ECR}:bootstrap"

echo "==> 2/5 build + push image"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ECR%/*}"
docker build -t "${ECR}:latest" "$(dirname "$TF_DIR")/.."
docker push "${ECR}:latest"

echo "==> 3/5 apply full stack"
terraform apply -input=false -auto-approve -var="container_image=${ECR}:latest"

echo "==> 4/5 run migrations + seed against the new RDS instance"
echo "    (run 'npm run migrate' and 'npm run seed:users' with DB_* pointed at:"
terraform output -raw db_endpoint
echo "     — from a bastion / one-off task inside the VPC, or temporarily make RDS public)"

echo "==> 5/5 done"
terraform output -raw service_url
