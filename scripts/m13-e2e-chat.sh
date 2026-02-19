#!/usr/bin/env bash
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
EMAIL="${CHAT3D_E2E_EMAIL:-${SEED_ADMIN_EMAIL:-admin@chat3d.local}}"
PASSWORD="${CHAT3D_E2E_PASSWORD:-${SEED_ADMIN_PASSWORD:-change-admin-password}}"
DISPLAY_NAME="${CHAT3D_E2E_DISPLAY_NAME:-Milestone13 E2E}"
PROMPT="${CHAT3D_E2E_PROMPT:-Create a simple cube and export it as STEP and STL.}"

echo "==> Login"
LOGIN_JSON="$(curl -sS -X POST "${BACKEND_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")"

TOKEN="$(echo "${LOGIN_JSON}" | jq -r '.token // empty')"
if [[ -z "${TOKEN}" ]]; then
  echo "Login failed, trying register flow for ${EMAIL}" >&2
  REGISTER_JSON="$(curl -sS -X POST "${BACKEND_URL}/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"displayName\":\"${DISPLAY_NAME}\"}")"
  REGISTERED_EMAIL="$(echo "${REGISTER_JSON}" | jq -r '.user.email // empty')"
  if [[ -z "${REGISTERED_EMAIL}" ]]; then
    echo "Register failed; cannot continue." >&2
    echo "${REGISTER_JSON}" >&2
    exit 1
  fi

  LOGIN_JSON="$(curl -sS -X POST "${BACKEND_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")"
  TOKEN="$(echo "${LOGIN_JSON}" | jq -r '.token // empty')"
fi

if [[ -z "${TOKEN}" ]]; then
  echo "Unable to obtain auth token." >&2
  exit 1
fi

echo "==> Create chat context"
CONTEXT_JSON="$(curl -sS -X POST "${BACKEND_URL}/api/chat/contexts" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"M13 E2E $(date +%Y-%m-%dT%H:%M:%S)\"}")"
CONTEXT_ID="$(echo "${CONTEXT_JSON}" | jq -r '.id // empty')"
if [[ -z "${CONTEXT_ID}" ]]; then
  echo "Failed to create chat context." >&2
  echo "${CONTEXT_JSON}" >&2
  exit 1
fi

echo "==> Submit query"
QUERY_JSON="$(curl -sS -X POST "${BACKEND_URL}/api/query/submit" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"contextId\":\"${CONTEXT_ID}\",\"prompt\":\"${PROMPT}\"}")"
ASSISTANT_ITEM_ID="$(echo "${QUERY_JSON}" | jq -r '.assistantItem.id // empty')"
GENERATED_PATH="$(echo "${QUERY_JSON}" | jq -r '.generatedFiles[0].path // empty')"
if [[ -z "${ASSISTANT_ITEM_ID}" || -z "${GENERATED_PATH}" ]]; then
  echo "Query failed or produced no generated files." >&2
  echo "${QUERY_JSON}" >&2
  exit 1
fi

echo "==> Download generated file: ${GENERATED_PATH}"
DOWNLOAD_TARGET="/tmp/chat3d-m13-$(date +%s).bin"
ENCODED_PATH="$(jq -rn --arg value "${GENERATED_PATH}" '$value|@uri')"
curl -sS -X GET "${BACKEND_URL}/api/files/download?path=${ENCODED_PATH}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -o "${DOWNLOAD_TARGET}"
if [[ ! -s "${DOWNLOAD_TARGET}" ]]; then
  echo "Downloaded file is empty." >&2
  exit 1
fi

echo "==> Rate assistant item"
RATING_JSON="$(curl -sS -X PATCH "${BACKEND_URL}/api/chat/contexts/${CONTEXT_ID}/items/${ASSISTANT_ITEM_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"rating":1}')"
RATING_VALUE="$(echo "${RATING_JSON}" | jq -r '.rating // empty')"
if [[ "${RATING_VALUE}" != "1" ]]; then
  echo "Failed to set rating." >&2
  echo "${RATING_JSON}" >&2
  exit 1
fi

echo "==> Regenerate assistant response"
REGEN_JSON="$(curl -sS -X POST "${BACKEND_URL}/api/query/regenerate" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"contextId\":\"${CONTEXT_ID}\",\"assistantItemId\":\"${ASSISTANT_ITEM_ID}\"}")"
REGEN_ASSISTANT_ID="$(echo "${REGEN_JSON}" | jq -r '.assistantItem.id // empty')"
if [[ -z "${REGEN_ASSISTANT_ID}" || "${REGEN_ASSISTANT_ID}" == "${ASSISTANT_ITEM_ID}" ]]; then
  echo "Regenerate did not produce a new assistant item." >&2
  echo "${REGEN_JSON}" >&2
  exit 1
fi

echo "==> M13 E2E completed"
echo "contextId=${CONTEXT_ID}"
echo "assistantItemId=${ASSISTANT_ITEM_ID}"
echo "regeneratedAssistantItemId=${REGEN_ASSISTANT_ID}"
echo "downloadedFile=${DOWNLOAD_TARGET}"
