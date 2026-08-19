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
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${SERVICE}"

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
  --set-secrets "SCORER_SIGNING_KEY=cifra-scorer-signing-key:latest" \
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
