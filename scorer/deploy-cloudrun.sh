#!/usr/bin/env bash
# Deploy the Cifra scoring service to Cloud Run and register its signing key on-chain.
#
#   PROJECT=my-gcp-project REGION=europe-west1 CHAIN_ID=968 ./deploy-cloudrun.sh
#
# The signing key is held in Secret Manager, never in an env var on the service definition —
# `gcloud run services describe` prints env vars in plain text to anyone with viewer access.
set -euo pipefail

PROJECT="${PROJECT:?set PROJECT}"
REGION="${REGION:-europe-west1}"
CHAIN_ID="${CHAIN_ID:?set CHAIN_ID (677 mainnet, 968 testnet)}"
SERVICE="${SERVICE:-cifra-scorer}"
REPO="${REPO:-cifra}"
SECRET="${SECRET:-cifra-scorer-signing-key}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${SERVICE}"

command -v gcloud >/dev/null || { echo "gcloud is required"; exit 1; }

case "$CHAIN_ID" in
  677|968) ;;
  *) echo "CHAIN_ID must be 677 (mainnet) or 968 (testnet); got '$CHAIN_ID'"; exit 1 ;;
esac

# Fail here rather than deep inside `gcloud run deploy`. CHAIN_ID is signed into every grade,
# so a service deployed against the wrong chain produces signatures the contract rejects.
if ! gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  echo "Secret '$SECRET' does not exist in $PROJECT."
  echo "Create it first:  PROJECT=$PROJECT ./scripts/provision-key.sh"
  exit 1
fi

# Artifact Registry repos are not created implicitly — `builds submit --tag` fails with a
# confusing permissions-shaped error if the repo is missing. Create it idempotently.
if ! gcloud artifacts repositories describe "$REPO" \
      --project "$PROJECT" --location "$REGION" >/dev/null 2>&1; then
  echo "==> creating Artifact Registry repo ${REPO} in ${REGION}"
  gcloud artifacts repositories create "$REPO" \
    --project "$PROJECT" --location "$REGION" \
    --repository-format=docker \
    --description="Cifra scoring service images"
fi

echo "==> building and pushing ${IMAGE}"
gcloud builds submit --project "$PROJECT" --tag "$IMAGE" .

# Resolve the immutable digest. This is what gets signed into every grade, so it must be the
# digest — a tag can be repointed later and would make the on-chain record meaningless.
DIGEST="$(gcloud artifacts docker images describe "${IMAGE}:latest" \
  --project "$PROJECT" --format='value(image_summary.digest)')"
echo "==> image digest ${DIGEST}"

echo "==> deploying ${SERVICE}"
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --image "${IMAGE}@${DIGEST}" \
  --set-env-vars "CHAIN_ID=${CHAIN_ID},IMAGE_DIGEST=${DIGEST}" \
  --set-secrets "SCORER_SIGNING_KEY=${SECRET}:latest" \
  --no-allow-unauthenticated \
  --min-instances=0 \
  --max-instances=4 \
  --cpu=1 --memory=256Mi \
  --port=8080

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')"
echo
echo "==> deployed: ${URL}"
echo
echo "Next: point the contract at this service's signing key."
echo "  curl -s -H \"Authorization: Bearer \$(gcloud auth print-identity-token)\" ${URL}/version"
echo "  # then, as the CifraAttestationNFT owner:"
echo "  #   attestation.setScorerAddress(<scorerAddress from /version>)"
echo
echo "Until that call lands, every attest() reverts with BadScorerSignature."
