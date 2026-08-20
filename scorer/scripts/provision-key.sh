#!/usr/bin/env bash
# Generate the scorer's signing key DIRECTLY into GCP Secret Manager and print only its address.
#
#   PROJECT=my-gcp-project ./scripts/provision-key.sh
#
# The private key is never written to disk, never echoed, and never leaves this shell's memory.
# That is the point: after Phase 1–4 a single key on a laptop was owner, operator, attester AND
# scorer. Splitting them is only worth anything if the scorer key genuinely never exists here.
#
# What you get back is the ADDRESS, which you then register on-chain:
#   attestation.setScorerAddress(<address>)   — via the governance Safe
set -euo pipefail

PROJECT="${PROJECT:?set PROJECT}"
SECRET="${SECRET:-cifra-scorer-signing-key}"

command -v node >/dev/null || { echo "node is required"; exit 1; }
command -v gcloud >/dev/null || { echo "gcloud is required"; exit 1; }

echo "==> generating a fresh secp256k1 key"
# Key material stays in one variable, piped straight to gcloud. Address is derived and printed.
# `ethers` is a repo-root dependency; resolve it from there so this works from scorer/.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
read -r PRIVKEY ADDRESS <<<"$(node -e '
  const { Wallet } = require(process.argv[1] + "/node_modules/ethers");
  const w = Wallet.createRandom();
  process.stdout.write(w.privateKey.slice(2) + " " + w.address);
' "$REPO_ROOT")"

echo "==> scorer address: ${ADDRESS}"

if gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  printf '%s' "$PRIVKEY" | gcloud secrets versions add "$SECRET" --project "$PROJECT" --data-file=-
  echo "==> added a new version to existing secret ${SECRET}"
else
  printf '%s' "$PRIVKEY" | gcloud secrets create "$SECRET" --project "$PROJECT" --replication-policy=automatic --data-file=-
  echo "==> created secret ${SECRET}"
fi

unset PRIVKEY

cat <<NEXT

Key is in Secret Manager as ${SECRET}. It is not on this machine.

Next:
  1. Grant the Cloud Run service account access:
       gcloud secrets add-iam-policy-binding ${SECRET} --project ${PROJECT} \\
         --member=serviceAccount:<run-sa>@${PROJECT}.iam.gserviceaccount.com \\
         --role=roles/secretmanager.secretAccessor
  2. Deploy:  PROJECT=${PROJECT} CHAIN_ID=<677|968> ./deploy-cloudrun.sh
  3. Register it on-chain, through the governance Safe:
       attestation.setScorerAddress(${ADDRESS})
  4. Confirm:  npx hardhat run scripts/verifyGov.ts --network botchain

Until step 3 lands, every attest() reverts with BadScorerSignature.
NEXT
