import { describe, it, expect } from 'vitest'
import { generateAwsCli, type SettingsForCli } from './cli'

const defaultSettings: SettingsForCli = {
  endpoint: 'http://localhost:4566',
  region: 'us-east-1',
}

const tunnelSettings: SettingsForCli = {
  endpoint: 'https://abc123.ngrok-free.app',
  region: 'eu-west-1',
}

describe('generateAwsCli', () => {
  describe('S3 operations (must use s3api)', () => {
    it('generates put-object command with file placeholder for normal uploads', () => {
      const result = generateAwsCli('s3', 'put-object', {
        Bucket: 'my-bucket',
        Key: 'folder/file.txt',
      }, defaultSettings)

      expect(result.command).toBe(
        'aws --endpoint-url=http://localhost:4566 --region=us-east-1 s3api put-object --bucket my-bucket --key folder/file.txt --body fileb://file.bin'
      )
      expect(result.instructions).toBeUndefined()
    })

    it('generates put-object with instructions for large/binary files', () => {
      const result = generateAwsCli('s3', 'put-object', {
        Bucket: 'my-bucket',
        Key: 'bigfile.bin',
        __isLargeOrBinary: true,
      }, defaultSettings)

      expect(result.command).toContain('--body fileb://file.bin --content-type application/octet-stream')
      expect(result.instructions).toContain('Save the exact bytes')
    })

    it('generates list-objects-v2 command', () => {
      const result = generateAwsCli('s3', 'list-objects-v2', { Bucket: 'my-bucket' }, defaultSettings)
      expect(result.command).toBe(
        'aws --endpoint-url=http://localhost:4566 --region=us-east-1 s3api list-objects-v2 --bucket my-bucket'
      )
    })

    it('generates create-bucket command', () => {
      const result = generateAwsCli('s3', 'create-bucket', { Bucket: 'new-bucket' }, defaultSettings)
      expect(result.command).toBe(
        'aws --endpoint-url=http://localhost:4566 --region=us-east-1 s3api create-bucket --bucket new-bucket'
      )
    })

    it('uses live endpoint and region (including tunnels)', () => {
      const result = generateAwsCli('s3', 'list-objects-v2', { Bucket: 'b' }, tunnelSettings)
      expect(result.command).toContain('--endpoint-url=https://abc123.ngrok-free.app --region=eu-west-1')
    })
  })

  describe('DynamoDB operations', () => {
    it('generates put-item with file placeholder', () => {
      const result = generateAwsCli('dynamodb', 'put-item', {
        TableName: 'Users',
        Item: { id: { S: '123' } },
      }, defaultSettings)

      expect(result.command).toBe(
        'aws --endpoint-url=http://localhost:4566 --region=us-east-1 dynamodb put-item --table-name Users --item file://item.json'
      )
      expect(result.instructions).toContain('item.json')
    })

    it('generates create-table with complex schema notes', () => {
      const result = generateAwsCli('dynamodb', 'create-table', {
        TableName: 'Orders',
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      }, defaultSettings)

      expect(result.command).toContain('dynamodb create-table --table-name Orders')
      expect(result.command).toContain('--attribute-definitions')
      expect(result.command).toContain('--key-schema')
      expect(result.instructions).toContain('cli-input-json')
    })
  })

  describe('SQS operations', () => {
    it('generates list-queues', () => {
      const result = generateAwsCli('sqs', 'list-queues', {}, defaultSettings)
      expect(result.command).toBe('aws --endpoint-url=http://localhost:4566 --region=us-east-1 sqs list-queues')
    })

    it('generates create-queue', () => {
      const result = generateAwsCli('sqs', 'create-queue', { QueueName: 'my-queue' }, defaultSettings)
      expect(result.command).toContain('sqs create-queue --queue-name my-queue')
    })

    it('generates send-message with file placeholder for large bodies', () => {
      const result = generateAwsCli('sqs', 'send-message', {
        QueueUrl: 'http://localhost:4566/000000000000/my-queue',
        MessageBody: 'x'.repeat(1000),
        __isLargeOrBinary: true,
      }, defaultSettings)

      expect(result.command).toContain('--message-body file://message.json')
    })

    it('generates receive-message with defaults', () => {
      const result = generateAwsCli('sqs', 'receive-message', {
        QueueUrl: 'http://.../my-queue',
      }, defaultSettings)
      expect(result.command).toContain('--max-number-of-messages 1 --wait-time-seconds 2')
    })

    it('generates delete-message with placeholder for receipt handle', () => {
      const result = generateAwsCli('sqs', 'delete-message', {
        QueueUrl: 'http://.../q',
      }, defaultSettings)
      expect(result.command).toContain('YOUR_RECEIPT_HANDLE_HERE')
      expect(result.instructions).toContain('ReceiptHandle')
    })

    it('generates purge-queue and delete-queue', () => {
      const purge = generateAwsCli('sqs', 'purge-queue', { QueueUrl: 'q' }, defaultSettings)
      const del = generateAwsCli('sqs', 'delete-queue', { QueueUrl: 'q' }, defaultSettings)

      expect(purge.command).toContain('purge-queue')
      expect(del.command).toContain('delete-queue')
    })
  })

  describe('SNS operations', () => {
    it('generates list-topics, create-topic, delete-topic', () => {
      expect(generateAwsCli('sns', 'list-topics', {}, defaultSettings).command).toContain('sns list-topics')
      expect(generateAwsCli('sns', 'create-topic', { Name: 'my-topic' }, defaultSettings).command)
        .toContain('sns create-topic --name my-topic')
      expect(generateAwsCli('sns', 'delete-topic', { TopicArn: 'arn' }, defaultSettings).command)
        .toContain('sns delete-topic')
    })

    it('generates publish with subject and large payload handling', () => {
      const result = generateAwsCli('sns', 'publish', {
        TopicArn: 'arn:aws:sns:...:my-topic',
        Message: 'hello world',
        Subject: 'Test Alert',
      }, defaultSettings)

      expect(result.command).toContain('--topic-arn "arn:aws:sns:...:my-topic"')
      expect(result.command).toContain('--subject "Test Alert"')
    })

    it('generates subscribe without filter', () => {
      const result = generateAwsCli('sns', 'subscribe', {
        TopicArn: 'arn',
        Protocol: 'sqs',
        Endpoint: 'http://localhost:4566/000000000000/my-queue',
      }, defaultSettings)

      expect(result.command).toContain('sns subscribe --topic-arn')
      expect(result.command).not.toContain('file://')
    })

    it('generates subscribe with filter policy using placeholder file', () => {
      const result = generateAwsCli('sns', 'subscribe', {
        TopicArn: 'arn',
        Protocol: 'sqs',
        Endpoint: 'queue-url',
        FilterPolicy: { event: ['created'] },
      }, defaultSettings)

      expect(result.command).toContain('--attributes file://filter-policy.json')
      expect(result.instructions).toContain('FilterPolicy')
    })

    it('generates set-subscription-attributes for filter updates', () => {
      const result = generateAwsCli('sns', 'set-subscription-attributes', {
        SubscriptionArn: 'arn:sub:123',
        FilterPolicy: { store: ['main'] },
      }, defaultSettings)

      expect(result.command).toContain('set-subscription-attributes')
      expect(result.command).toContain('--attribute-name FilterPolicy')
      expect(result.instructions).toContain('filter-policy.json')
    })
  })

  describe('Fallback and edge cases', () => {
    it('falls back to generic command for unknown operations', () => {
      const result = generateAwsCli('lambda', 'invoke', { FunctionName: 'fn' }, defaultSettings)
      expect(result.command).toContain('lambda invoke')
      expect(result.command).toContain('# (parameters omitted')
    })

    it('handles endpoint with trailing slash', () => {
      const result = generateAwsCli('s3', 'list-objects-v2', { Bucket: 'b' }, {
        endpoint: 'http://localhost:4566/',
        region: 'us-east-1',
      })
      expect(result.command).toContain('--endpoint-url=http://localhost:4566 --region')
    })
  })
})