// Central pure CLI command generator (the signature feature).
// Must always use the *live* settings (endpoint + region).
// For large/binary payloads: always return placeholder + instructions (never embed data).

export type CliResult = {
  command: string
  instructions?: string
}

export type SettingsForCli = {
  endpoint: string
  region: string
}

export function generateAwsCli(
  service: string,
  operation: string,
  params: Record<string, unknown>,
  settings: SettingsForCli
): CliResult {
  const ep = settings.endpoint.replace(/\/$/, '')
  const region = settings.region

  const base = `aws --endpoint-url=${ep} --region=${region}`

  // S3 must use s3api (per locked decision)
  if (service.toLowerCase() === 's3') {
    if (operation === 'put-object') {
      const bucket = params.Bucket as string
      const key = params.Key as string
      const isLargeOrBinary = (params as any).__isLargeOrBinary === true

      if (isLargeOrBinary) {
        return {
          command: `${base} s3api put-object --bucket ${bucket} --key ${key} --body fileb://file.bin --content-type application/octet-stream`,
          instructions: 'Save the exact bytes you used in the UI to `file.bin` in your current directory before running the command.',
        }
      }
      return {
        command: `${base} s3api put-object --bucket ${bucket} --key ${key} --body fileb://file.bin`,
        instructions: undefined,
      }
    }

    if (operation === 'list-objects-v2') {
      const bucket = params.Bucket as string
      return {
        command: `${base} s3api list-objects-v2 --bucket ${bucket}`,
      }
    }

    if (operation === 'create-bucket') {
      const bucket = (params.Bucket as string) || (params.BucketName as string)
      return {
        command: `${base} s3api create-bucket --bucket ${bucket}`,
      }
    }
  }

  // Generic example for other services (DynamoDB, SQS, etc.)
  if (service.toLowerCase() === 'dynamodb' && operation === 'put-item') {
    const table = params.TableName as string
    // For demo: if complex/large, use file placeholder
    return {
      command: `${base} dynamodb put-item --table-name ${table} --item file://item.json`,
      instructions: 'Write the following JSON (the exact item you are putting) to item.json first.',
    }
  }

  if (service.toLowerCase() === 'dynamodb' && operation === 'create-table') {
    const table = params.TableName as string
    // For create-table the schema is complex. Produce a usable command with key flags + note about full JSON.
    // Users can also copy and adjust.
    const attrDefs = params.AttributeDefinitions ? JSON.stringify(params.AttributeDefinitions) : '[{"AttributeName":"id","AttributeType":"S"}]'
    const keySchema = params.KeySchema ? JSON.stringify(params.KeySchema) : '[{"AttributeName":"id","KeyType":"HASH"}]'
    return {
      command: `${base} dynamodb create-table --table-name ${table} --attribute-definitions '${attrDefs}' --key-schema '${keySchema}' --billing-mode PAY_PER_REQUEST`,
      instructions: 'Adjust the attribute-definitions and key-schema as needed. For very complex schemas save the full JSON to a file and use --cli-input-json file://create-table.json',
    }
  }

  // === SQS ===
  if (service.toLowerCase() === 'sqs') {
    if (operation === 'list-queues') {
      return { command: `${base} sqs list-queues` }
    }
    if (operation === 'create-queue') {
      const queueName = params.QueueName as string
      return {
        command: `${base} sqs create-queue --queue-name ${queueName}`,
      }
    }
    if (operation === 'send-message') {
      const queueUrl = params.QueueUrl as string
      const body = (params.MessageBody as string) || ''
      const isLarge = (params as any).__isLargeOrBinary === true
      if (isLarge || body.length > 800) {
        return {
          command: `${base} sqs send-message --queue-url "${queueUrl}" --message-body file://message.json`,
          instructions: 'Save the message body to message.json (exact content you used in the UI).',
        }
      }
      // Escape basic quoting for shell
      const escaped = body.replace(/"/g, '\\"')
      return {
        command: `${base} sqs send-message --queue-url "${queueUrl}" --message-body "${escaped}"`,
      }
    }
    if (operation === 'receive-message') {
      const queueUrl = params.QueueUrl as string
      const max = (params.MaxNumberOfMessages as number) || 1
      return {
        command: `${base} sqs receive-message --queue-url "${queueUrl}" --max-number-of-messages ${max} --wait-time-seconds 2`,
      }
    }
    if (operation === 'delete-message') {
      const queueUrl = params.QueueUrl as string
      // Receipt handle is usually long and ugly – we tell user to replace
      return {
        command: `${base} sqs delete-message --queue-url "${queueUrl}" --receipt-handle "YOUR_RECEIPT_HANDLE_HERE"`,
        instructions: 'Replace YOUR_RECEIPT_HANDLE_HERE with the ReceiptHandle from a previous receive-message call.',
      }
    }
    if (operation === 'purge-queue') {
      const queueUrl = params.QueueUrl as string
      return {
        command: `${base} sqs purge-queue --queue-url "${queueUrl}"`,
      }
    }
    if (operation === 'delete-queue') {
      const queueUrl = params.QueueUrl as string
      return {
        command: `${base} sqs delete-queue --queue-url "${queueUrl}"`,
      }
    }
  }

  // === SNS ===
  if (service.toLowerCase() === 'sns') {
    if (operation === 'list-topics') {
      return { command: `${base} sns list-topics` }
    }
    if (operation === 'create-topic') {
      const name = params.Name as string
      return {
        command: `${base} sns create-topic --name ${name}`,
      }
    }
    if (operation === 'publish') {
      const topicArn = params.TopicArn as string
      const msg = (params.Message as string) || ''
      const subject = params.Subject as string | undefined
      const isLarge = (params as any).__isLargeOrBinary === true
      let cmd = `${base} sns publish --topic-arn "${topicArn}"`
      if (subject) cmd += ` --subject "${subject.replace(/"/g, '\\"')}"`
      if (isLarge || msg.length > 800) {
        cmd += ` --message file://message.json`
        return {
          command: cmd,
          instructions: 'Save the exact message payload to message.json before running.',
        }
      }
      const escaped = msg.replace(/"/g, '\\"')
      cmd += ` --message "${escaped}"`
      return { command: cmd }
    }
    if (operation === 'subscribe') {
      const topicArn = params.TopicArn as string
      const protocol = (params.Protocol as string) || 'sqs'
      const endpoint = params.Endpoint as string
      let cmd = `${base} sns subscribe --topic-arn "${topicArn}" --protocol ${protocol} --notification-endpoint "${endpoint}"`
      const fp = params.FilterPolicy
      if (fp) {
        const fpStr = typeof fp === 'string' ? fp : JSON.stringify(fp)
        cmd += ` --attributes file://filter-policy.json`
        return {
          command: cmd,
          instructions: `Create filter-policy.json with the content:\n{\n  "FilterPolicy": ${fpStr}\n}`,
        }
      }
      return { command: cmd }
    }
    if (operation === 'set-subscription-attributes') {
      const subArn = params.SubscriptionArn as string
      const fp = params.FilterPolicy
      let cmd = `${base} sns set-subscription-attributes --subscription-arn "${subArn}" --attribute-name FilterPolicy`
      if (fp) {
        const fpStr = typeof fp === 'string' ? fp : JSON.stringify(fp)
        cmd += ` --attribute-value file://filter-policy.json`
        return {
          command: cmd,
          instructions: `Create filter-policy.json with:\n${fpStr}`,
        }
      }
      return { command: cmd }
    }
    if (operation === 'unsubscribe') {
      const subArn = params.SubscriptionArn as string
      return {
        command: `${base} sns unsubscribe --subscription-arn "${subArn}"`,
      }
    }
    if (operation === 'delete-topic') {
      const topicArn = params.TopicArn as string
      return {
        command: `${base} sns delete-topic --topic-arn "${topicArn}"`,
      }
    }
  }

  // Fallback generic
  const opKebab = operation.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
  return {
    command: `${base} ${service.toLowerCase()} ${opKebab}  # (parameters omitted for brevity in this skeleton)`,
  }
}
