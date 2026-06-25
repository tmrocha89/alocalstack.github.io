import { useState, useEffect } from 'react'
import { useSettings } from '../lib/settings'
import { generateAwsCli } from '../lib/cli'
import { CliCommand } from '../components/CliCommand'
import { createSQSClient } from '../lib/aws'
import {
  ListQueuesCommand,
  CreateQueueCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  PurgeQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs'
import { toast } from 'sonner'
import { RefreshCw, Plus, Send, Trash2, AlertTriangle, Copy, Eye } from 'lucide-react'

export default function SQSPage() {
  const { settings } = useSettings()
  const [queues, setQueues] = useState<string[]>([])
  const [selectedQueue, setSelectedQueue] = useState('')
  const [selectedQueueArn, setSelectedQueueArn] = useState('')
  const [messages, setMessages] = useState<any[]>([])

  // Create queue
  const [newQueueName, setNewQueueName] = useState('')

  // Send message form
  const [messageBody, setMessageBody] = useState('{\n  "hello": "from alocalstack"\n}')

  const [lastCli, setLastCli] = useState<{ command: string; instructions?: string } | null>(null)

  const [viewMessage, setViewMessage] = useState<any>(null)
  const [modalTab, setModalTab] = useState<'details' | 'raw'>('details')

  async function listQueues() {
    try {
      const client = createSQSClient(settings)
      const res = await client.send(new ListQueuesCommand({}))
      const urls = res.QueueUrls || []
      setQueues(urls)
      toast.success(`Found ${urls.length} queue(s)`)
    } catch (e: any) {
      toast.error('Failed to list queues', { description: e.message })
    }
  }

  // Auto list queues on page entry
  useEffect(() => {
    listQueues()
  }, [])

  async function doCreateQueue() {
    const name = newQueueName.trim()
    if (!name) {
      toast.error('Enter a queue name')
      return
    }
    try {
      const client = createSQSClient(settings)
      const res = await client.send(new CreateQueueCommand({ QueueName: name }))
      const queueUrl = res.QueueUrl!

      const cli = generateAwsCli('sqs', 'create-queue', { QueueName: name }, settings)
      setLastCli(cli)

      toast.success(`Queue created: ${name}`)
      setNewQueueName('')
      await listQueues()

      // Auto-select the newly created queue (this will also fetch ARN)
      await selectQueue(queueUrl)
    } catch (e: any) {
      toast.error('Failed to create queue', { description: e.message })
    }
  }

  async function selectQueue(url: string) {
    setSelectedQueue(url)
    setSelectedQueueArn('')
    setMessages([])
    await fetchQueueArn(url)
  }

  async function fetchQueueArn(url: string) {
    try {
      const client = createSQSClient(settings)
      const res = await client.send(new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: ['QueueArn'],
      }))
      const arn = res.Attributes?.QueueArn || ''
      setSelectedQueueArn(arn)
    } catch {
      setSelectedQueueArn('')
    }
  }

  function openMessageModal(message: any) {
    setViewMessage(message)
    setModalTab('details')
  }

  async function copyToClipboard(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error(`Failed to copy ${label}`)
    }
  }

  function prettyBody(body: string | undefined): string {
    if (!body) return ''
    try {
      const parsed = JSON.parse(body)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return body
    }
  }

  async function doSendMessage() {
    if (!selectedQueue) {
      toast.error('Select a queue first')
      return
    }
    const body = messageBody.trim()
    if (!body) {
      toast.error('Message body is required')
      return
    }

    const isLarge = body.length > 800

    try {
      const client = createSQSClient(settings)
      await client.send(new SendMessageCommand({
        QueueUrl: selectedQueue,
        MessageBody: body,
      }))

      const cliParams: any = { QueueUrl: selectedQueue, MessageBody: body }
      if (isLarge) cliParams.__isLargeOrBinary = true

      const cli = generateAwsCli('sqs', 'send-message', cliParams, settings)
      setLastCli(cli)

      toast.success('Message sent')
    } catch (e: any) {
      toast.error('Send message failed', { description: e.message })
    }
  }

  async function doReceiveMessages() {
    if (!selectedQueue) return
    try {
      const client = createSQSClient(settings)
      const res = await client.send(new ReceiveMessageCommand({
        QueueUrl: selectedQueue,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 2,
      }))

      const received = res.Messages || []
      setMessages(received)

      const cli = generateAwsCli('sqs', 'receive-message', {
        QueueUrl: selectedQueue,
        MaxNumberOfMessages: 10,
      }, settings)
      setLastCli(cli)

      toast.success(`Received ${received.length} message(s)`)
    } catch (e: any) {
      toast.error('Receive failed', { description: e.message })
    }
  }

  async function doDeleteMessage(receiptHandle: string, messageId?: string) {
    if (!selectedQueue) return
    try {
      const client = createSQSClient(settings)
      await client.send(new DeleteMessageCommand({
        QueueUrl: selectedQueue,
        ReceiptHandle: receiptHandle,
      }))

      const cli = generateAwsCli('sqs', 'delete-message', {
        QueueUrl: selectedQueue,
      }, settings)
      setLastCli(cli)

      // Remove from local list
      setMessages(prev => prev.filter(m => m.ReceiptHandle !== receiptHandle))
      toast.success(`Deleted message ${messageId || ''}`)
    } catch (e: any) {
      toast.error('Delete message failed', { description: e.message })
    }
  }

  async function doPurgeQueue() {
    if (!selectedQueue) return
    if (!confirm('Purge ALL messages from this queue? This cannot be undone.')) return

    try {
      const client = createSQSClient(settings)
      await client.send(new PurgeQueueCommand({ QueueUrl: selectedQueue }))

      const cli = generateAwsCli('sqs', 'purge-queue', { QueueUrl: selectedQueue }, settings)
      setLastCli(cli)

      setMessages([])
      toast.success('Queue purged')
    } catch (e: any) {
      toast.error('Purge failed', { description: e.message })
    }
  }

  async function doDeleteQueue() {
    if (!selectedQueue) return
    if (!confirm('Delete this queue permanently?')) return

    try {
      const client = createSQSClient(settings)
      await client.send(new DeleteQueueCommand({ QueueUrl: selectedQueue }))

      const cli = generateAwsCli('sqs', 'delete-queue', { QueueUrl: selectedQueue }, settings)
      setLastCli(cli)

      setSelectedQueue('')
      setSelectedQueueArn('')
      setMessages([])
      await listQueues()
      toast.success('Queue deleted')
    } catch (e: any) {
      toast.error('Delete queue failed', { description: e.message })
    }
  }

  // Extract a friendly name from the URL for display
  function queueName(url: string) {
    try {
      return url.split('/').pop() || url
    } catch {
      return url
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">SQS</h2>
      </div>

      {/* Queues list + Create */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Queues</div>
          <button onClick={listQueues} className="btn flex items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4" /> List Queues
          </button>
        </div>

        {/* Create Queue */}
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs text-zinc-400 block mb-1">Create Queue</label>
            <input
              className="input w-full"
              placeholder="my-queue"
              value={newQueueName}
              onChange={e => setNewQueueName(e.target.value)}
            />
          </div>
          <button onClick={doCreateQueue} disabled={!newQueueName.trim()} className="btn">
            <Plus className="h-4 w-4 mr-1 inline" /> Create
          </button>
        </div>

        {queues.length === 0 ? (
          <div className="text-xs text-zinc-500">No queues yet. Create one above or click List Queues.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {queues.map(url => (
              <button
                key={url}
                onClick={() => selectQueue(url)}
                className={`px-3 py-1 rounded text-sm border font-mono break-all max-w-[420px] text-left ${selectedQueue === url ? 'bg-zinc-800 border-zinc-500' : 'border-zinc-700 hover:bg-zinc-900'}`}
              >
                {url}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected queue actions */}
      {selectedQueue && (
        <div className="card p-4 mb-4">
          {/* Queue identifiers with copy icons */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-zinc-400 w-12 shrink-0">URL</span>
              <div className="flex items-center gap-0.5 font-mono text-emerald-400 break-all text-sm flex-1 min-w-0">
                <span>{selectedQueue}</span>
                <button
                  onClick={() => copyToClipboard(selectedQueue, 'Queue URL')}
                  className="text-zinc-400 hover:text-emerald-300 p-0.5 -mr-0.5"
                  title="Copy Queue URL"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {selectedQueueArn && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 w-12 shrink-0">ARN</span>
                <div className="flex items-center gap-0.5 font-mono text-emerald-400 break-all text-sm flex-1 min-w-0">
                  <span>{selectedQueueArn}</span>
                  <button
                    onClick={() => copyToClipboard(selectedQueueArn, 'Queue ARN')}
                    className="text-zinc-400 hover:text-emerald-300 p-0.5 -mr-0.5"
                    title="Copy Queue ARN"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button onClick={doReceiveMessages} className="btn text-sm flex items-center gap-1.5">
              <RefreshCw className="h-4 w-4" /> Receive Messages
            </button>
            <button onClick={doPurgeQueue} className="btn text-sm text-amber-400 hover:text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Purge
            </button>
            <button onClick={doDeleteQueue} className="btn text-sm text-red-400 hover:text-red-300 flex items-center gap-1.5">
              <Trash2 className="h-4 w-4" /> Delete Queue
            </button>
          </div>

          {/* Send Message */}
          <div className="mb-4 pt-4 border-t border-zinc-700">
            <div className="font-medium text-sm mb-2 flex items-center gap-2">
              <Send className="h-4 w-4" /> Send Message
            </div>
            <textarea
              className="input w-full font-mono text-xs h-28 mb-2"
              value={messageBody}
              onChange={e => setMessageBody(e.target.value)}
              placeholder="Message body (string or JSON)"
            />
            <button onClick={doSendMessage} className="btn">Send Message</button>
            <p className="text-[10px] text-zinc-500 mt-1">
              Messages are sent as strings. Large bodies will use a file placeholder in the generated CLI.
            </p>
          </div>

          {/* Received Messages */}
          <div className="pt-3 border-t border-zinc-700">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-sm">Received Messages</div>
              <div className="text-xs text-zinc-500">Click Receive Messages above to poll</div>
            </div>

            {messages.length === 0 ? (
              <div className="text-xs text-zinc-500 py-2">No messages received yet for this session.</div>
            ) : (
              <div className="overflow-auto border border-zinc-800 rounded max-h-80">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-900 text-zinc-400">
                    <tr>
                      <th className="text-left px-3 py-1.5">MessageId</th>
                      <th className="text-left px-3 py-1.5">Body</th>
                      <th className="text-left px-3 py-1.5 w-48">ReceiptHandle (truncated)</th>
                      <th className="w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages.map((m, idx) => (
                      <tr key={idx} className="border-t border-zinc-800 hover:bg-zinc-950">
                        <td
                          className="px-3 py-1 font-mono text-[10px] break-all cursor-pointer hover:underline"
                          onClick={() => openMessageModal(m)}
                        >
                          {m.MessageId}
                        </td>
                        <td
                          className="px-3 py-1 font-mono text-[10px] break-all max-w-[420px] truncate cursor-pointer"
                          title={m.Body}
                          onClick={() => openMessageModal(m)}
                        >
                          {m.Body}
                        </td>
                        <td
                          className="px-3 py-1 font-mono text-[10px] text-zinc-400 break-all cursor-pointer hover:underline"
                          onClick={async () => {
                            await navigator.clipboard.writeText(m.ReceiptHandle)
                            toast.success('ReceiptHandle copied')
                          }}
                          title="Click to copy full ReceiptHandle"
                        >
                          {String(m.ReceiptHandle).slice(0, 60)}…
                        </td>
                        <td className="px-3 py-1 text-right">
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => openMessageModal(m)}
                              className="text-zinc-400 hover:text-zinc-200"
                              title="View full message"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => doDeleteMessage(m.ReceiptHandle, m.MessageId)}
                              className="text-red-400 hover:text-red-300"
                              title="Delete this message"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CLI reveal */}
      {lastCli && (
        <CliCommand
          command={lastCli.command}
          instructions={lastCli.instructions}
          defaultOpen={true}
          title="Equivalent AWS CLI command (SQS)"
        />
      )}

      {/* Message Detail Modal */}
      {viewMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setViewMessage(null)}
        >
          <div
            className="card w-full max-w-3xl mx-4 p-4 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-medium">Message Details</div>
                <div className="text-[10px] text-zinc-400 font-mono mt-0.5">{viewMessage.MessageId}</div>
              </div>
              <button onClick={() => setViewMessage(null)} className="text-xl leading-none text-zinc-400 hover:text-white">×</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-zinc-800 mb-3">
              <button
                onClick={() => setModalTab('details')}
                className={`px-4 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                  modalTab === 'details' ? 'border-emerald-400 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Details
              </button>
              <button
                onClick={() => setModalTab('raw')}
                className={`px-4 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                  modalTab === 'raw' ? 'border-emerald-400 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Raw JSON
              </button>
            </div>

            {/* Fixed height content area (keeps modal size the same).
                Body textarea made taller. Receipt Handle moved below this area. */}
            <div className="h-[360px] overflow-y-auto mb-3 border border-zinc-800 rounded p-2">
              {modalTab === 'details' ? (
                <div className="space-y-3">
                  {/* Body - increased height */}
                  <div>
                    <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                      <span>Body</span>
                      <button
                        onClick={() => copyToClipboard(viewMessage.Body || '', 'Message Body')}
                        className="text-xs btn px-2 py-0.5 flex items-center gap-1"
                      >
                        <Copy className="h-3 w-3" /> Copy Body
                      </button>
                    </div>
                    <textarea
                      className="input w-full font-mono text-xs h-60 resize-y bg-zinc-950"
                      value={prettyBody(viewMessage.Body)}
                      readOnly
                      spellCheck={false}
                    />
                  </div>

                  {/* Attributes */}
                  {viewMessage.Attributes && Object.keys(viewMessage.Attributes).length > 0 && (
                    <div>
                      <div className="text-xs text-zinc-400 mb-1">Attributes</div>
                      <pre className="text-[10px] bg-zinc-950 p-2 rounded overflow-auto max-h-28">
                        {JSON.stringify(viewMessage.Attributes, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* MessageAttributes */}
                  {viewMessage.MessageAttributes && Object.keys(viewMessage.MessageAttributes).length > 0 && (
                    <div>
                      <div className="text-xs text-zinc-400 mb-1">Message Attributes</div>
                      <pre className="text-[10px] bg-zinc-950 p-2 rounded overflow-auto max-h-28">
                        {JSON.stringify(viewMessage.MessageAttributes, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                /* Raw JSON tab - uses the same fixed container height */
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                    <span>Full Message (raw JSON)</span>
                    <button
                      onClick={() => copyToClipboard(JSON.stringify(viewMessage, null, 2), 'Full Message JSON')}
                      className="text-xs btn px-2 py-0.5 flex items-center gap-1"
                    >
                      <Copy className="h-3 w-3" /> Copy
                    </button>
                  </div>
                  <textarea
                    className="input w-full font-mono text-xs flex-1 resize-y bg-zinc-950"
                    value={JSON.stringify(viewMessage, null, 2)}
                    readOnly
                    spellCheck={false}
                  />
                </div>
              )}
            </div>

            {/* Receipt Handle pushed to the bottom of the modal (outside the fixed content area) */}
            {modalTab === 'details' && (
              <div className="mb-3">
                <div className="text-xs text-zinc-400 mb-1">Receipt Handle</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 font-mono text-[10px] break-all bg-zinc-950 p-2 rounded">
                    {viewMessage.ReceiptHandle}
                  </div>
                  <button
                    onClick={() => copyToClipboard(viewMessage.ReceiptHandle || '', 'Receipt Handle')}
                    className="btn text-xs px-2 py-0.5 flex items-center gap-1"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <button
                onClick={async () => {
                  await doDeleteMessage(viewMessage.ReceiptHandle, viewMessage.MessageId)
                  setViewMessage(null)
                }}
                className="btn text-sm text-red-400 hover:text-red-300 border-red-500/40"
              >
                Delete Message
              </button>

              <button onClick={() => setViewMessage(null)} className="btn text-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="text-xs text-zinc-500 mt-6">
        All operations use the live endpoint/region. Receipt handles are required for DeleteMessage (they are shown after Receive).
      </div>
    </div>
  )
}
