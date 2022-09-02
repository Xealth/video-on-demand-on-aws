#!/bin/bash
ENV=$1
VERSION=5.3.1
if [ $ENV == "staging" ]
then
  AccountId=870539749295
elif [ $ENV == "production" ]
then
  AccountId=240871576430
else
  echo "$0 staging | production"
  exit -1
fi

echo '...........Building package'
./build-s3-dist.sh "xealth.${AccountId}.aws-vod-deployment" aws-vod-xealth  $VERSION

echo "...........Uploading to s3"
aws s3 cp ./regional-s3-assets/ "s3://xealth.${AccountId}.aws-vod-deployment-us-west-2/aws-vod-xealth/${VERSION}" --recursive --acl bucket-owner-full-control

echo "done"
