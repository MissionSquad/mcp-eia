#!/usr/bin/env bash
set -euo pipefail

# Probe EIA RTO hourly dataset to discover valid respondent/type values
# and verify that recent series contain numeric data.
#
# Usage:
#   bash mcp-eia/scripts/probe_rto.sh
#
# Requirements:
# - .env file at mcp-eia/.env containing EIA_API_KEY=your_key
#   (or export EIA_API_KEY in your shell environment)
# - curl present; jq optional (for pretty JSON)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env (if present)
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$ROOT_DIR/.env"
  set +a
fi

if [[ -z "${EIA_API_KEY:-}" ]]; then
  echo "ERROR: EIA_API_KEY is not set. Add it to $ROOT_DIR/.env or export it in your shell." 1>&2
  exit 1
fi

BASE="https://api.eia.gov/v2/electricity/rto/region-data"

# Compute a date 7 days ago; use macOS (date -v) if available, else GNU date
if date -v-7d +%Y-%m-%d >/dev/null 2>&1; then
  START="$(date -v-7d +%Y-%m-%d)"
else
  START="$(date -d '7 days ago' +%Y-%m-%d)"
fi

if command -v jq >/dev/null 2>&1; then
  PRETTY="jq ."
else
  PRETTY="cat"
fi

echo "=== Route metadata: rto/region-data ==="
curl -s "$BASE?api_key=$EIA_API_KEY" | eval "$PRETTY"

echo
echo "=== Facet: respondent (authoritative IDs) ==="
curl -s "$BASE/facet/respondent?api_key=$EIA_API_KEY" | eval "$PRETTY"

echo
echo "=== Facet: type (series types) ==="
curl -s "$BASE/facet/type?api_key=$EIA_API_KEY" | eval "$PRETTY"

probe() {
  local RESP="$1"
  local TYPE="$2"
  local LEN="${3:-48}" # hours
  echo
  echo "=== Probe data (respondent=$RESP, type=$TYPE, last $LEN hours starting $START) ==="
  curl -s "$BASE/data?api_key=$EIA_API_KEY&frequency=hourly&facets[respondent][]=$RESP&facets[type][]=$TYPE&start=$START&sort[0][column]=period&sort[0][direction]=desc&length=$LEN" | eval "$PRETTY"
}

# Common respondents to probe; adjust or add based on facet listing above
probe "CAL" "D" 48   # CAISO demand
probe "ERC" "D" 48   # ERCOT demand
probe "PJM" "D" 48   # PJM demand
probe "CAL" "NG" 48  # CAISO net generation (fallback if demand is sparse)

echo
echo "Tips:"
echo "- Use the respondent IDs exactly as returned by the 'respondent' facet listing above."
echo "- If a series returns empty/sparse data for type 'D' (Demand), try 'NG' (Net Generation) or increase the window."
echo "- These responses are authoritative: use them to select arguments for getRTODemandSnapshot."
