import { useState, useEffect } from 'react'
import { useSettings } from '../lib/settings'
import { generateAwsCli } from '../lib/cli'
import { CliCommand } from '../components/CliCommand'
import { createSNSClient } from '../lib/aws'
import {
  ListTopicsCommand,
  CreateTopicCommand,
  PublishCommand,
  SubscribeCommand,
  ListSubscriptionsByTopicCommand,
  UnsubscribeCommand,
  DeleteTopicCommand,
  SetSubscriptionAttributesCommand,
} from '@aws-sdk/client-sns'
import { toast } from 'sonner'
import { RefreshCw, Plus, Send, Trash2, Bell, Filter } from 'lucide-react'

export default function SNSPage() {
  const { settings } = useSettings()
  const [topics, setTopics] = useState<string[]>([]) // ARNs
  const [selectedTopic, setSelectedTopic] = useState('')
  const [subscriptions, setSubscriptions] = useState<any[]>([])

  // Create topic
  const [newTopicName, setNewTopicName] = useState('')

  // Publish form
  const [publishMessage, setPublishMessage] = useState('Hello from alocalstack')
  const [publishSubject, setPublishSubject] = useState('')

  // Subscribe form
  const [subProtocol, setSubProtocol] = useState('sqs')
  const [subEndpoint, setSubEndpoint] = useState('')
  const [subFilterPolicy, setSubFilterPolicy] = useState('')

  // Edit filter on existing subscription
  const [filterSubArn, setFilterSubArn] = useState('')
  const [filterPolicyText, setFilterPolicyText] = useState('')

  const [lastCli, setLastCli] = useState<{ command: string; instructions?: string } | null>(null)

  async function listTopics() {
    try {
      const client = createSNSClient(settings)
      const res = await client.send(new ListTopicsCommand({}))
      const arns = (res.Topics || []).map(t => t.TopicArn!).filter(Boolean)
      setTopics(arns)
      toast.success(`Found ${arns.length} topic(s)`)
    } catch (e: any) {
      toast.error('Failed to list topics', { description: e.message })
    }
  }

  // Auto list topics on page entry
  useEffect(() => {
    listTopics()
  }, [])

  async function doCreateTopic() {
    const name = newTopicName.trim()
    if (!name) {
      toast.error('Enter a topic name')
      return
    }
    try {
      const client = createSNSClient(settings)
      const res = await client.send(new CreateTopicCommand({ Name: name }))
      const arn = res.TopicArn!

      const cli = generateAwsCli('sns', 'create-topic', { Name: name }, settings)
      setLastCli(cli)

      toast.success(`Topic created`)
      setNewTopicName('')
      await listTopics()
      setSelectedTopic(arn)
      setSubscriptions([])
    } catch (e: any) {
      toast.error('Failed to create topic', { description: e.message })
    }
  }

  async function selectTopic(arn: string) {
    setSelectedTopic(arn)
    setSubscriptions([])
    setFilterSubArn('')
    setFilterPolicyText('')
    await loadSubscriptions(arn)
  }

  async function loadSubscriptions(topicArn: string) {
    try {
      const client = createSNSClient(settings)
      const res = await client.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }))
      setSubscriptions(res.Subscriptions || [])
    } catch (e: any) {
      // Non-fatal for now
      setSubscriptions([])
    }
  }

  async function doPublish() {
    if (!selectedTopic) {
      toast.error('Select a topic first')
      return
    }
    const message = publishMessage.trim()
    if (!message) {
      toast.error('Message is required')
      return
    }

    const isLarge = message.length > 800

    try {
      const client = createSNSClient(settings)
      const params: any = {
        TopicArn: selectedTopic,
        Message: message,
      }
      if (publishSubject.trim()) params.Subject = publishSubject.trim()

      await client.send(new PublishCommand(params))

      const cliParams: any = { TopicArn: selectedTopic, Message: message }
      if (publishSubject.trim()) cliParams.Subject = publishSubject.trim()
      if (isLarge) cliParams.__isLargeOrBinary = true

      const cli = generateAwsCli('sns', 'publish', cliParams, settings)
      setLastCli(cli)

      toast.success('Message published')
    } catch (e: any) {
      toast.error('Publish failed', { description: e.message })
    }
  }

  async function doSubscribe() {
    if (!selectedTopic) {
      toast.error('Select a topic first')
      return
    }
    const endpoint = subEndpoint.trim()
    if (!endpoint) {
      toast.error('Enter a subscription endpoint')
      return
    }
    const protocol = subProtocol.trim() || 'sqs'

    const attributes: Record<string, string> = {}
    if (subFilterPolicy.trim()) {
      try {
        const parsed = JSON.parse(subFilterPolicy.trim())
        attributes.FilterPolicy = JSON.stringify(parsed)
      } catch {
        toast.error('Filter policy must be valid JSON')
        return
      }
    }

    try {
      const client = createSNSClient(settings)
      await client.send(new SubscribeCommand({
        TopicArn: selectedTopic,
        Protocol: protocol,
        Endpoint: endpoint,
        ...(Object.keys(attributes).length ? { Attributes: attributes } : {}),
      }))

      const cliParams: any = { TopicArn: selectedTopic, Protocol: protocol, Endpoint: endpoint }
      if (subFilterPolicy.trim()) {
        try { cliParams.FilterPolicy = JSON.parse(subFilterPolicy.trim()) } catch {}
      }
      const cli = generateAwsCli('sns', 'subscribe', cliParams, settings)
      setLastCli(cli)

      toast.success(`Subscription requested (${protocol})`)
      setSubEndpoint('')
      setSubFilterPolicy('')
      // Refresh subscriptions
      await loadSubscriptions(selectedTopic)
    } catch (e: any) {
      toast.error('Subscribe failed', { description: e.message })
    }
  }

  async function doUpdateFilter() {
    if (!filterSubArn) return
    try {
      const client = createSNSClient(settings)
      const value = filterPolicyText.trim() || '{}'
      // Validate JSON
      JSON.parse(value)

      await client.send(new SetSubscriptionAttributesCommand({
        SubscriptionArn: filterSubArn,
        AttributeName: 'FilterPolicy',
        AttributeValue: value,
      }))

      const cli = generateAwsCli('sns', 'set-subscription-attributes', {
        SubscriptionArn: filterSubArn,
        FilterPolicy: JSON.parse(value),
      }, settings)
      setLastCli(cli)

      toast.success('Filter policy updated')
      setFilterSubArn('')
      setFilterPolicyText('')
      await loadSubscriptions(selectedTopic)
    } catch (e: any) {
      toast.error('Failed to update filter', { description: e.message })
    }
  }

  async function doUnsubscribe(subArn: string) {
    try {
      const client = createSNSClient(settings)
      await client.send(new UnsubscribeCommand({ SubscriptionArn: subArn }))

      const cli = generateAwsCli('sns', 'unsubscribe', { SubscriptionArn: subArn }, settings)
      setLastCli(cli)

      setSubscriptions(prev => prev.filter(s => s.SubscriptionArn !== subArn))
      toast.success('Unsubscribed')
    } catch (e: any) {
      toast.error('Unsubscribe failed', { description: e.message })
    }
  }

  async function doDeleteTopic() {
    if (!selectedTopic) return
    if (!confirm('Delete this SNS topic permanently?')) return

    try {
      const client = createSNSClient(settings)
      await client.send(new DeleteTopicCommand({ TopicArn: selectedTopic }))

      const cli = generateAwsCli('sns', 'delete-topic', { TopicArn: selectedTopic }, settings)
      setLastCli(cli)

      setSelectedTopic('')
      setSubscriptions([])
      await listTopics()
      toast.success('Topic deleted')
    } catch (e: any) {
      toast.error('Delete topic failed', { description: e.message })
    }
  }

  // Nice display name from ARN
  function topicShort(arn: string) {
    try {
      return arn.split(':').pop() || arn
    } catch {
      return arn
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">SNS</h2>
      </div>

      {/* Topics */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Topics</div>
          <button onClick={listTopics} className="btn flex items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4" /> List Topics
          </button>
        </div>

        {/* Create Topic */}
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs text-zinc-400 block mb-1">Create Topic</label>
            <input
              className="input w-full"
              placeholder="my-topic"
              value={newTopicName}
              onChange={e => setNewTopicName(e.target.value)}
            />
          </div>
          <button onClick={doCreateTopic} disabled={!newTopicName.trim()} className="btn">
            <Plus className="h-4 w-4 mr-1 inline" /> Create
          </button>
        </div>

        {topics.length === 0 ? (
          <div className="text-xs text-zinc-500">No topics yet. Create one above.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {topics.map(arn => (
              <button
                key={arn}
                onClick={() => selectTopic(arn)}
                className={`px-3 py-1 rounded text-sm border font-mono break-all max-w-[520px] text-left ${selectedTopic === arn ? 'bg-zinc-800 border-zinc-500' : 'border-zinc-700 hover:bg-zinc-900'}`}
              >
                {arn}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected Topic */}
      {selectedTopic && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="font-medium">Topic:</span>{' '}
              <span className="font-mono text-emerald-400 break-all text-sm">{selectedTopic}</span>
            </div>
            <button onClick={doDeleteTopic} className="btn text-sm text-red-400 hover:text-red-300 flex items-center gap-1.5">
              <Trash2 className="h-4 w-4" /> Delete Topic
            </button>
          </div>

          {/* Publish */}
          <div className="mb-4 pt-4 border-t border-zinc-700">
            <div className="font-medium text-sm mb-2 flex items-center gap-2">
              <Send className="h-4 w-4" /> Publish Message
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-2">
              <input
                className="input md:col-span-1"
                placeholder="Subject (optional)"
                value={publishSubject}
                onChange={e => setPublishSubject(e.target.value)}
              />
              <div className="md:col-span-3">
                <textarea
                  className="input w-full font-mono text-xs h-20"
                  value={publishMessage}
                  onChange={e => setPublishMessage(e.target.value)}
                />
              </div>
            </div>

            <button onClick={doPublish} className="btn">Publish</button>
            <p className="text-[10px] text-zinc-500 mt-1">Large messages will suggest a file:// placeholder in the CLI.</p>
          </div>

          {/* Subscribe */}
          <div className="mb-4 pt-4 border-t border-zinc-700">
            <div className="font-medium text-sm mb-2 flex items-center gap-2">
              <Bell className="h-4 w-4" /> Subscribe
            </div>
            <div className="flex flex-wrap items-end gap-2 mb-2">
              <select
                className="input w-28"
                value={subProtocol}
                onChange={e => setSubProtocol(e.target.value)}
              >
                <option value="sqs">sqs</option>
                <option value="lambda">lambda</option>
                <option value="http">http</option>
                <option value="https">https</option>
                <option value="email">email</option>
                <option value="sms">sms</option>
              </select>
              <input
                className="input flex-1 min-w-[260px]"
                placeholder="Endpoint (queue URL, email, lambda ARN, http://...)"
                value={subEndpoint}
                onChange={e => setSubEndpoint(e.target.value)}
              />
              <button onClick={doSubscribe} disabled={!subEndpoint.trim()} className="btn">
                Subscribe
              </button>
            </div>

            <div className="w-full">
              <label className="text-[10px] text-zinc-400 block mb-0.5">Filter Policy (JSON, optional)</label>
              <textarea
                className="input w-full font-mono text-xs h-14"
                placeholder='{"store": ["example"], "event": ["order_placed"]}'
                value={subFilterPolicy}
                onChange={e => setSubFilterPolicy(e.target.value)}
              />
            </div>
            <p className="text-[10px] text-zinc-500">For SQS, use the full queue URL as endpoint. Use JSON filter policy to deliver only matching messages.</p>
          </div>

          {/* Edit existing subscription filter */}
          {filterSubArn && (
            <div className="mb-4 p-3 border border-amber-500/40 bg-zinc-900 rounded">
              <div className="text-xs text-amber-400 mb-1">Update Filter Policy</div>
              <div className="font-mono text-[10px] mb-1 text-zinc-400 truncate">{filterSubArn}</div>
              <textarea
                className="input w-full font-mono text-xs h-16 mb-2"
                value={filterPolicyText}
                onChange={e => setFilterPolicyText(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={doUpdateFilter} className="btn text-xs">Update Filter</button>
                <button 
                  onClick={() => { setFilterSubArn(''); setFilterPolicyText('') }} 
                  className="btn text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Subscriptions */}
          <div className="pt-3 border-t border-zinc-700">
            <div className="font-medium text-sm mb-2">Subscriptions</div>
            {subscriptions.length === 0 ? (
              <div className="text-xs text-zinc-500">No subscriptions for this topic yet.</div>
            ) : (
              <div className="overflow-auto border border-zinc-800 rounded">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-900 text-zinc-400">
                    <tr>
                      <th className="text-left px-3 py-1.5">Protocol</th>
                      <th className="text-left px-3 py-1.5">Endpoint</th>
                      <th className="text-left px-3 py-1.5">SubscriptionArn</th>
                      <th className="text-left px-3 py-1.5">Filter</th>
                      <th className="w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((sub, i) => (
                      <tr key={i} className="border-t border-zinc-800 hover:bg-zinc-950">
                        <td className="px-3 py-1">{sub.Protocol}</td>
                        <td className="px-3 py-1 font-mono text-[10px] break-all">{sub.Endpoint}</td>
                        <td className="px-3 py-1 font-mono text-[10px] text-zinc-400 break-all">{sub.SubscriptionArn}</td>
                        <td 
                          className="px-3 py-1 font-mono text-[9px] text-zinc-400 max-w-[140px] truncate cursor-pointer hover:text-zinc-200"
                          title={sub.Attributes?.FilterPolicy || 'No filter policy'}
                          onClick={() => {
                            if (sub.Attributes?.FilterPolicy) {
                              setFilterSubArn(sub.SubscriptionArn)
                              setFilterPolicyText(sub.Attributes.FilterPolicy)
                            }
                          }}
                        >
                          {sub.Attributes?.FilterPolicy 
                            ? sub.Attributes.FilterPolicy.substring(0, 32) + '…' 
                            : '—'}
                        </td>
                        <td className="px-3 py-1 text-right">
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => {
                                setFilterSubArn(sub.SubscriptionArn)
                                setFilterPolicyText(sub.Attributes?.FilterPolicy || '{}')
                              }}
                              className="text-amber-400 hover:text-amber-300"
                              title="Edit filter policy"
                            >
                              <Filter className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => doUnsubscribe(sub.SubscriptionArn)}
                              className="text-red-400 hover:text-red-300"
                              title="Unsubscribe"
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
          title="Equivalent AWS CLI command (SNS)"
        />
      )}

      <div className="text-xs text-zinc-500 mt-6">
        SNS publish and subscribe use the live endpoint. Subscribe to SQS by using the queue URL as the endpoint.
      </div>
    </div>
  )
}
