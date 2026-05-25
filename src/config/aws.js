'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const env = require('./env');

const isS3Configured = Boolean(
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY &&
  process.env.AWS_S3_BUCKET_NAME
);

let s3Client = null;

if (isS3Configured) {
  s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

async function uploadBuffer(key, buffer, mimetype) {
  if (!isS3Configured) throw new Error("S3 not configured");
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mimetype || 'application/octet-stream'
  });
  await s3Client.send(command);
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
}

module.exports = {
  isS3Configured,
  s3Client,
  bucketName: process.env.AWS_S3_BUCKET_NAME,
  uploadBuffer
};
