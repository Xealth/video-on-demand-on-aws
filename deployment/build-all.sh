#!/bin/bash
#
# Builds the solution and uploads it to a new, versioned prefix in the Xealth
# deployment bucket:
#   s3://xealth.<account>.aws-vod-deployment-us-west-2/aws-vod-xealth/<version>/
#
# Usage: ./build-all.sh <staging|production> <version>
#   e.g. ./build-all.sh staging 6.1.18-xealth.1
#
# Running CloudFormation stacks read their template and Lambda packages from an
# existing prefix (5.3.1/ for the v5 stack), so this script refuses to upload
# to any prefix that already contains objects.
set -euo pipefail

SOLUTION_NAME=aws-vod-xealth
REGION=us-west-2

usage() {
  echo "Usage: $0 <staging|production> <version>" >&2
  echo "  version: semver, major 6 or later, e.g. 6.1.18-xealth.1" >&2
  exit 1
}

[ "$#" -eq 2 ] || usage
ENV="$1"
VERSION="$2"

case "$ENV" in
staging) ACCOUNT_ID="${XEALTH_STAGING_ACCOUNT_ID:-}" ;;
production) ACCOUNT_ID="${XEALTH_PRODUCTION_ACCOUNT_ID:-}" ;;
*) usage ;;
esac

if [ -z "$ACCOUNT_ID" ]; then
  echo "The account ID environment variable for '$ENV' is not set." >&2
  exit 1
fi

if ! [[ "$VERSION" =~ ^([0-9]+)\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]] || [ "${BASH_REMATCH[1]}" -lt 6 ]; then
  echo "Invalid version '$VERSION'." >&2
  usage
fi

BUCKET_BASE="xealth.${ACCOUNT_ID}.aws-vod-deployment"
BUCKET="${BUCKET_BASE}-${REGION}"
PREFIX="${SOLUTION_NAME}/${VERSION}/"
DEST="s3://${BUCKET}/${PREFIX}"

existing_key=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$PREFIX" \
  --max-items 1 --query 'Contents[0].Key' --output text)
if [ "$existing_key" != "None" ]; then
  echo "Refusing to upload: ${SOLUTION_NAME}/${VERSION}/ already contains objects." >&2
  echo "Pick a new version; existing prefixes may back a running stack." >&2
  exit 1
fi

cd "$(dirname "$0")"

echo "...........Building package"
./build-s3-dist.sh "$BUCKET_BASE" "$SOLUTION_NAME" "$VERSION"

echo "...........Uploading to ${SOLUTION_NAME}/${VERSION}/"
aws s3 cp ./regional-s3-assets/ "$DEST" --recursive --acl bucket-owner-full-control
aws s3 cp "./global-s3-assets/${SOLUTION_NAME}.template" "${DEST}video-on-demand-on-aws.template" --acl bucket-owner-full-control

echo "done"
