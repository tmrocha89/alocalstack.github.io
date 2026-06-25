import { S3Client } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { SQSClient } from '@aws-sdk/client-sqs'
import { SNSClient } from '@aws-sdk/client-sns'
import type { Settings } from './settings'

// LocalStack friendly credentials (no real auth needed for local)
const CREDENTIALS = {
  accessKeyId: 'test',
  secretAccessKey: 'test',
}

// Create clients that respect the live endpoint + region from settings.
export function createS3Client(settings: Settings) {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    credentials: CREDENTIALS,
    forcePathStyle: true, // important for LocalStack S3
    // Disable automatic checksums by default.
    // This avoids triggering bugs in LocalStack's S3 v3 provider when creating
    // empty "folder" marker objects (keys ending with / and zero-byte body),
    // which can lead to "checksum is None" errors during put_object.
    // Regular uploads will still work; users who want explicit checksums can pass
    // ChecksumAlgorithm in the command.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  })
}

export function createDynamoDBClient(settings: Settings) {
  return new DynamoDBClient({
    endpoint: settings.endpoint,
    region: settings.region,
    credentials: CREDENTIALS,
  })
}

export function createSQSClient(settings: Settings) {
  return new SQSClient({
    endpoint: settings.endpoint,
    region: settings.region,
    credentials: CREDENTIALS,
  })
}

export function createSNSClient(settings: Settings) {
  return new SNSClient({
    endpoint: settings.endpoint,
    region: settings.region,
    credentials: CREDENTIALS,
  })
}
