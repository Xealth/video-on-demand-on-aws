#!/bin/bash
#
# Publishes only the CloudFormation template, as release RELEASE, for the Xealth aws-video-on-demand-solution
# stack (xealth-terraform modules/cms_media_serving). Unlike build-all.sh, it builds no Lambda code.
#
# The Lambda code version stays at 5.3.1 on purpose: the deployed functions run nodejs12.x and python3.7,
# which AWS no longer lets anyone update. %%VERSION%% sets each function's code key and SOLUTION_IDENTIFIER,
# so a different value would make CloudFormation update every function, fail, and roll back. With 5.3.1 the
# functions stay exactly as they are; only the resources this release changes are updated.
#
#   ./publish-template.sh staging 5.3.1-xealth.2            # render and diff against the deployed stack
#   ./publish-template.sh staging 5.3.1-xealth.2 --upload   # also upload it
#
# Run it with credentials for the account (Leapp: Role-Staging-Devops / Role-Master-Devops). Then point
# template_url in xealth-terraform's cms_media_serving at aws-vod-xealth/<RELEASE>/.
set -euo pipefail

CODE_VERSION=5.3.1
SOLUTION_NAME=aws-vod-xealth
STACK=aws-video-on-demand-solution
REGION=us-west-2

ENV=${1:-}
RELEASE=${2:-}
UPLOAD=${3:-}
case "$ENV" in
  staging) ACCOUNT_ID=870539749295 ;;
  production) ACCOUNT_ID=240871576430 ;;
  *)
    echo "Usage: $0 staging|production RELEASE [--upload]" >&2
    exit 2
    ;;
esac
[[ -n "$RELEASE" ]] || {
  echo "Usage: $0 staging|production RELEASE [--upload]" >&2
  exit 2
}

actual=$(aws sts get-caller-identity --query Account --output text)
[[ "$actual" == "$ACCOUNT_ID" ]] || {
  echo "The active credentials are for account $actual, not $ACCOUNT_ID ($ENV). Switch Leapp first." >&2
  exit 1
}

here=$(cd "$(dirname "$0")" && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

sed -e "s/%%BUCKET_NAME%%/xealth.${ACCOUNT_ID}.aws-vod-deployment/g" \
  -e "s/%%SOLUTION_NAME%%/${SOLUTION_NAME}/g" \
  -e "s/%%VERSION%%/${CODE_VERSION}/g" \
  "$here/video-on-demand-on-aws.yaml" > "$out/video-on-demand-on-aws.template"

aws cloudformation get-template --stack-name "$STACK" --region "$REGION" --query TemplateBody --output text > "$out/deployed.template"
echo "== Diff: deployed $STACK template -> $RELEASE"
diff -u --label deployed --label "$RELEASE" "$out/deployed.template" "$out/video-on-demand-on-aws.template" || true

if [[ "$UPLOAD" == "--upload" ]]; then
  dest="s3://xealth.${ACCOUNT_ID}.aws-vod-deployment-${REGION}/${SOLUTION_NAME}/${RELEASE}/video-on-demand-on-aws.template"
  aws s3 cp "$out/video-on-demand-on-aws.template" "$dest" --acl bucket-owner-full-control
  echo "Uploaded $dest"
fi
