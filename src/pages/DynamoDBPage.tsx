import { useState, useMemo, useEffect } from 'react'
import { useSettings } from '../lib/settings'
import { generateAwsCli } from '../lib/cli'
import { CliCommand } from '../components/CliCommand'
import { createDynamoDBClient } from '../lib/aws'
import { 
  ListTablesCommand, 
  ScanCommand, 
  PutItemCommand, 
  CreateTableCommand, 
  BillingMode,
  DescribeTableCommand,
  DeleteItemCommand,
  QueryCommand
} from '@aws-sdk/client-dynamodb'
import { toast } from 'sonner'
import { RefreshCw, Plus, Eye, Edit2, Trash2 } from 'lucide-react'

export default function DynamoDBPage() {
  const { settings } = useSettings()
  const [tables, setTables] = useState<string[]>([])
  const [selectedTable, setSelectedTable] = useState('')
  const [_tableInfo, setTableInfo] = useState<any>(null) // from DescribeTable (kept for future metadata display)
  const [keyNames, setKeyNames] = useState<string[]>([])
  const [items, setItems] = useState<any[]>([]) // raw DynamoDB items
  const [modal, setModal] = useState<null | { mode: 'view' | 'edit' | 'delete'; item: any }>(null)
  const [modalJson, setModalJson] = useState('')

  // Compute nice columns for the table: partition + sort keys always first
  const columns = useMemo(() => {
    if (!items.length) return keyNames
    const allAttrs = new Set<string>()
    items.forEach((it: any) => Object.keys(it).forEach(k => allAttrs.add(k)))
    const keySet = new Set(keyNames)
    const otherCols = Array.from(allAttrs).filter(a => !keySet.has(a)).sort()
    return [...keyNames, ...otherCols]
  }, [items, keyNames])

  // Put Item form
  const [putTable, setPutTable] = useState('')
  const [itemJson, setItemJson] = useState('{\n  "id": { "S": "123" },\n  "name": { "S": "example" }\n}')
  const [lastCli, setLastCli] = useState<{ command: string; instructions?: string } | null>(null)

  // Create Table form
  const [newTableName, setNewTableName] = useState('')
  const [partitionKeyName, setPartitionKeyName] = useState('id')
  const [partitionKeyType, setPartitionKeyType] = useState<'S' | 'N' | 'B'>('S')
  const [sortKeyName, setSortKeyName] = useState('')
  const [sortKeyType, setSortKeyType] = useState<'S' | 'N' | 'B'>('S')

  // Secondary indexes for create
  const [gsis, setGsis] = useState<any[]>([])
  const [lsis, setLsis] = useState<any[]>([])

  // Query
  const [isQueryMode, setIsQueryMode] = useState(false)
  const [selectedQueryTarget, setSelectedQueryTarget] = useState('Primary')
  const [queryPartitionValue, setQueryPartitionValue] = useState('')
  const [querySortValue, setQuerySortValue] = useState('')
  const [querySortCondition, setQuerySortCondition] = useState<'=' | 'begins_with'>('=')

  async function listTables() {
    try {
      const client = createDynamoDBClient(settings)
      const res = await client.send(new ListTablesCommand({}))
      const names = res.TableNames || []
      setTables(names)
      toast.success(`Found ${names.length} table(s)`)
    } catch (e: any) {
      toast.error('Failed to list tables', { description: e.message })
    }
  }

  async function selectTable(table: string) {
    setSelectedTable(table)
    setItems([])
    setTableInfo(null)
    setKeyNames([])
    setPutTable(table)

    try {
      const client = createDynamoDBClient(settings)
      const desc = await client.send(new DescribeTableCommand({ TableName: table }))
      const tableDesc = desc.Table
      setTableInfo(tableDesc)

      const keys = (tableDesc?.KeySchema || []).map((k: any) => k.AttributeName)
      setKeyNames(keys)

      await scanTableForTable(table) // scan after describing
    } catch (e: any) {
      toast.error('Failed to describe table', { description: e.message })
      // still try to scan
      await scanTableForTable(table)
    }
  }

  // Internal scan that accepts table name (to avoid stale state)
  async function scanTableForTable(table: string) {
    if (!table) return
    try {
      const client = createDynamoDBClient(settings)
      const res = await client.send(new ScanCommand({ TableName: table, Limit: 25 }))
      setItems(res.Items || [])
      toast.success(`Scanned ${res.Items?.length || 0} items from ${table}`)
    } catch (e: any) {
      toast.error('Scan failed', { description: e.message })
    }
  }

  async function scanTable() {
    const table = selectedTable || putTable
    if (!table) return
    await scanTableForTable(table)
  }

  async function doPutItem() {
    const table = putTable || selectedTable
    if (!table) {
      toast.error('Enter or select a table name')
      return
    }

    let item: Record<string, any>
    try {
      item = JSON.parse(itemJson)
    } catch {
      toast.error('Invalid JSON for Item')
      return
    }

    const isComplex = itemJson.length > 800 // heuristic for "use file placeholder"

    try {
      const client = createDynamoDBClient(settings)
      await client.send(new PutItemCommand({
        TableName: table,
        Item: item,
      }))

      const cliParams: any = { TableName: table, Item: item }
      if (isComplex) {
        cliParams.__isLargeOrBinary = true // our generator treats this as "use file://"
      }

      const cli = generateAwsCli('dynamodb', 'put-item', cliParams, settings)
      setLastCli(cli)

      toast.success('PutItem succeeded')
      // refresh scan if we have a selected table
      if (selectedTable) scanTable()
    } catch (e: any) {
      toast.error('PutItem failed', { description: e.message })
    }
  }

  async function doCreateTable() {
    const tableName = newTableName.trim()
    if (!tableName) {
      toast.error('Table name is required')
      return
    }
    if (!partitionKeyName.trim()) {
      toast.error('Partition key name is required')
      return
    }
    if (lsis.length > 0 && !sortKeyName.trim()) {
      toast.error('Local Secondary Indexes require the base table to have a sort key')
      return
    }

    const attributeDefinitions: any[] = [
      { AttributeName: partitionKeyName.trim(), AttributeType: partitionKeyType }
    ]
    const keySchema: any[] = [
      { AttributeName: partitionKeyName.trim(), KeyType: 'HASH' }
    ]

    if (sortKeyName.trim()) {
      attributeDefinitions.push({ AttributeName: sortKeyName.trim(), AttributeType: sortKeyType })
      keySchema.push({ AttributeName: sortKeyName.trim(), KeyType: 'RANGE' })
    }

    // Build secondary indexes (declare early to avoid TDZ issues)
    const gsiList: any[] = []
    const lsiList: any[] = []

    // Build GSIs
    gsis.forEach(g => {
      if (!g.name?.trim() || !g.pkName?.trim()) return
      const gKeySchema: any[] = [{ AttributeName: g.pkName.trim(), KeyType: 'HASH' }]
      const gAttrs: any[] = [{ AttributeName: g.pkName.trim(), AttributeType: g.pkType }]
      if (g.skName?.trim()) {
        gKeySchema.push({ AttributeName: g.skName.trim(), KeyType: 'RANGE' })
        gAttrs.push({ AttributeName: g.skName.trim(), AttributeType: g.skType })
      }
      gAttrs.forEach((a: any) => {
        if (!attributeDefinitions.some((ad: any) => ad.AttributeName === a.AttributeName)) {
          attributeDefinitions.push(a)
        }
      })
      gsiList.push({
        IndexName: g.name.trim(),
        KeySchema: gKeySchema,
        Projection: { ProjectionType: 'ALL' }
      })
    })

    // Build LSIs (Local Secondary Indexes)
    const basePk = partitionKeyName.trim()
    lsis.forEach(l => {
      if (!l.name?.trim() || !l.skName?.trim()) return
      const lsk = l.skName.trim()
      const lAttr = { AttributeName: lsk, AttributeType: l.skType }
      if (!attributeDefinitions.some((ad: any) => ad.AttributeName === lsk)) {
        attributeDefinitions.push(lAttr)
      }
      lsiList.push({
        IndexName: l.name.trim(),
        KeySchema: [
          { AttributeName: basePk, KeyType: 'HASH' },
          { AttributeName: lsk, KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' }
      })
    })

    try {
      const client = createDynamoDBClient(settings)
      await client.send(new CreateTableCommand({
        TableName: tableName,
        AttributeDefinitions: attributeDefinitions,
        KeySchema: keySchema,
        BillingMode: BillingMode.PAY_PER_REQUEST,
        ...(gsiList.length > 0 ? { GlobalSecondaryIndexes: gsiList } : {}),
        ...(lsiList.length > 0 ? { LocalSecondaryIndexes: lsiList } : {}),
      }))

      const cliParams: any = {
        TableName: tableName,
        AttributeDefinitions: attributeDefinitions,
        KeySchema: keySchema,
        BillingMode: 'PAY_PER_REQUEST',
        ...(gsiList.length > 0 ? { GlobalSecondaryIndexes: gsiList } : {}),
        ...(lsiList.length > 0 ? { LocalSecondaryIndexes: lsiList } : {})
      }
      const cli = generateAwsCli('dynamodb', 'create-table', cliParams, settings)
      setLastCli(cli)

      toast.success(`Table ${tableName} created`)
      setNewTableName('')
      setGsis([])
      setLsis([])
      listTables()
    } catch (e: any) {
      toast.error('Failed to create table', { description: e.message })
    }
  }

  // Modal helpers for item view/edit/delete
  function openItemModal(mode: 'view' | 'edit' | 'delete', item: any) {
    setModal({ mode, item })
    setModalJson(JSON.stringify(item, null, 2))
  }

  function closeModal() {
    setModal(null)
    setModalJson('')
  }

  async function saveEdit() {
    if (!modal || !selectedTable) return
    try {
      const newItem = JSON.parse(modalJson)
      const client = createDynamoDBClient(settings)
      await client.send(new PutItemCommand({
        TableName: selectedTable,
        Item: newItem,
      }))

      const cli = generateAwsCli('dynamodb', 'put-item', { TableName: selectedTable, Item: newItem }, settings)
      setLastCli(cli)

      toast.success('Item updated')
      closeModal()
      await scanTable()
    } catch (e: any) {
      toast.error('Update failed', { description: e.message })
    }
  }

  async function confirmDelete() {
    if (!modal || !selectedTable) return
    try {
      const item = modal.item
      // Build key from known keyNames
      const key: Record<string, any> = {}
      for (const k of keyNames) {
        if (item[k]) key[k] = item[k]
      }

      const client = createDynamoDBClient(settings)
      await client.send(new DeleteItemCommand({
        TableName: selectedTable,
        Key: key,
      }))

      const cli = generateAwsCli('dynamodb', 'delete-item', { TableName: selectedTable, ...key }, settings)
      setLastCli(cli)

      toast.success('Item deleted')
      closeModal()
      await scanTable()
    } catch (e: any) {
      toast.error('Delete failed', { description: e.message })
    }
  }

  // GSI helpers for Create Table
  function addGsi() {
    setGsis([...gsis, {
      name: `gsi-${gsis.length + 1}`,
      pkName: '',
      pkType: 'S',
      skName: '',
      skType: 'S'
    }])
  }
  function updateGsi(idx: number, field: string, val: string) {
    const copy = [...gsis]
    copy[idx] = { ...copy[idx], [field]: val }
    setGsis(copy)
  }
  function removeGsi(idx: number) {
    setGsis(gsis.filter((_, i) => i !== idx))
  }

  // LSI helpers for Create Table (requires base table sort key)
  function addLsi() {
    if (!sortKeyName.trim()) {
      toast.error('Base table must have a sort key to create an LSI')
      return
    }
    setLsis([...lsis, {
      name: `lsi-${lsis.length + 1}`,
      skName: '',
      skType: 'S'
    }])
  }
  function updateLsi(idx: number, field: string, val: string) {
    const copy = [...lsis]
    copy[idx] = { ...copy[idx], [field]: val }
    setLsis(copy)
  }
  function removeLsi(idx: number) {
    setLsis(lsis.filter((_, i) => i !== idx))
  }

  // Query targets (Primary + GSIs + LSIs from tableInfo)
  const queryTargets = useMemo(() => {
    const list: any[] = []
    if (keyNames.length > 0) {
      list.push({ name: 'Primary', pk: keyNames[0], sk: keyNames[1] || null })
    }
    if (_tableInfo?.GlobalSecondaryIndexes?.length) {
      _tableInfo.GlobalSecondaryIndexes.forEach((gsi: any) => {
        const pk = gsi.KeySchema?.find((k: any) => k.KeyType === 'HASH')?.AttributeName
        const sk = gsi.KeySchema?.find((k: any) => k.KeyType === 'RANGE')?.AttributeName
        if (pk) list.push({ name: gsi.IndexName, pk, sk: sk || null })
      })
    }
    if (_tableInfo?.LocalSecondaryIndexes?.length) {
      _tableInfo.LocalSecondaryIndexes.forEach((lsi: any) => {
        const pk = lsi.KeySchema?.find((k: any) => k.KeyType === 'HASH')?.AttributeName
        const sk = lsi.KeySchema?.find((k: any) => k.KeyType === 'RANGE')?.AttributeName
        if (pk) list.push({ name: lsi.IndexName, pk, sk: sk || null })
      })
    }
    return list
  }, [keyNames, _tableInfo])

  const currentQueryTarget = queryTargets.find((t: any) => t.name === selectedQueryTarget) || queryTargets[0]

  function getDynamoValue(v: string) {
    const t = v.trim()
    if (!t) return { S: v }
    if (!isNaN(Number(t))) return { N: t }
    if (t.toLowerCase() === 'true') return { BOOL: true }
    if (t.toLowerCase() === 'false') return { BOOL: false }
    return { S: v }
  }

  async function executeQuery() {
    if (!selectedTable || !queryPartitionValue || !currentQueryTarget) {
      toast.error('Provide partition key value for query')
      return
    }
    try {
      const client = createDynamoDBClient(settings)
      const names: any = { '#pk': currentQueryTarget.pk }
      const values: any = { ':pk': getDynamoValue(queryPartitionValue) }
      let cond = '#pk = :pk'

      if (currentQueryTarget.sk && querySortValue) {
        names['#sk'] = currentQueryTarget.sk
        if (querySortCondition === '=') {
          values[':sk'] = getDynamoValue(querySortValue)
          cond += ' AND #sk = :sk'
        } else if (querySortCondition === 'begins_with') {
          values[':sk'] = getDynamoValue(querySortValue)
          cond += ' AND begins_with(#sk, :sk)'
        }
      }

      const indexName = selectedQueryTarget === 'Primary' ? undefined : selectedQueryTarget

      const res = await client.send(new QueryCommand({
        TableName: selectedTable,
        IndexName: indexName,
        KeyConditionExpression: cond,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        Limit: 25
      }))

      setItems(res.Items || [])
      const cliParams: any = {
        TableName: selectedTable,
        KeyConditionExpression: cond,
        ExpressionAttributeValues: values
      }
      if (indexName) cliParams.IndexName = indexName
      const cli = generateAwsCli('dynamodb', 'query', cliParams, settings)
      setLastCli(cli)

      toast.success(`Query returned ${res.Items?.length || 0} items`)
    } catch (e: any) {
      toast.error('Query failed', { description: e.message })
    }
  }

  // Auto-list tables when entering the page
  useEffect(() => {
    listTables()
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">DynamoDB</h2>
      </div>

      {/* Tables + Create Table */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Tables</div>
          <button onClick={listTables} className="btn flex items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4" /> List Tables
          </button>
        </div>

        {/* Create Table form */}
        <div className="mb-4 border border-zinc-700 rounded p-3">
          <div className="font-medium text-sm mb-2 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Create Table
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-zinc-400">Table Name</label>
              <input className="input w-full mt-1" value={newTableName} onChange={e => setNewTableName(e.target.value)} placeholder="MyTable" />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Partition Key Name</label>
              <input className="input w-full mt-1" value={partitionKeyName} onChange={e => setPartitionKeyName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Partition Key Type</label>
              <select className="input w-full mt-1" value={partitionKeyType} onChange={e => setPartitionKeyType(e.target.value as any)}>
                <option value="S">S (String)</option>
                <option value="N">N (Number)</option>
                <option value="B">B (Binary)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400">Sort Key Name (optional)</label>
              <input className="input w-full mt-1" value={sortKeyName} onChange={e => setSortKeyName(e.target.value)} placeholder="(none)" />
            </div>
            {sortKeyName.trim() && (
              <div className="lg:col-span-1">
                <label className="text-xs text-zinc-400">Sort Key Type</label>
                <select className="input w-full mt-1" value={sortKeyType} onChange={e => setSortKeyType(e.target.value as any)}>
                  <option value="S">S (String)</option>
                  <option value="N">N (Number)</option>
                  <option value="B">B (Binary)</option>
                </select>
              </div>
            )}
          </div>

          {/* Secondary Indexes (GSI) */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-zinc-400">Global Secondary Indexes (optional)</div>
              <button type="button" onClick={addGsi} className="btn text-xs px-2 py-0.5">+ Add GSI</button>
            </div>
            {gsis.map((g, i) => (
              <div key={i} className="mb-2 p-2 border border-zinc-600 rounded text-xs">
                <div className="flex gap-2 mb-1 items-center">
                  <input className="input flex-1 text-xs" placeholder="Index Name" value={g.name} onChange={e => updateGsi(i, 'name', e.target.value)} />
                  <button type="button" onClick={() => removeGsi(i)} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  <input className="input text-xs" placeholder="PK Name" value={g.pkName} onChange={e => updateGsi(i, 'pkName', e.target.value)} />
                  <select className="input text-xs" value={g.pkType} onChange={e => updateGsi(i, 'pkType', e.target.value)}>
                    <option value="S">S</option>
                    <option value="N">N</option>
                    <option value="B">B</option>
                  </select>
                  <input className="input text-xs" placeholder="SK Name (opt)" value={g.skName} onChange={e => updateGsi(i, 'skName', e.target.value)} />
                  <select className="input text-xs" value={g.skType} onChange={e => updateGsi(i, 'skType', e.target.value)}>
                    <option value="S">S</option>
                    <option value="N">N</option>
                    <option value="B">B</option>
                  </select>
                </div>
              </div>
            ))}
            {gsis.length === 0 && <div className="text-[10px] text-zinc-500">Click + Add GSI to create a secondary index</div>}
          </div>

          {/* Local Secondary Indexes (LSI) - requires base table sort key */}
          {sortKeyName.trim() && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-zinc-400">Local Secondary Indexes (LSI) - same partition key as base table</div>
                <button 
                  type="button" 
                  onClick={addLsi} 
                  disabled={!sortKeyName.trim()}
                  className="btn text-xs px-2 py-0.5 disabled:opacity-50"
                >
                  + Add LSI
                </button>
              </div>
              {lsis.map((l, i) => (
                <div key={i} className="mb-2 p-2 border border-zinc-600 rounded text-xs">
                  <div className="flex gap-2 mb-1 items-center">
                    <input className="input flex-1 text-xs" placeholder="Index Name" value={l.name} onChange={e => updateLsi(i, 'name', e.target.value)} />
                    <button type="button" onClick={() => removeLsi(i)} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <input className="input text-xs" placeholder="Sort Key Name (new for this index)" value={l.skName} onChange={e => updateLsi(i, 'skName', e.target.value)} />
                    <select className="input text-xs" value={l.skType} onChange={e => updateLsi(i, 'skType', e.target.value)}>
                      <option value="S">S</option>
                      <option value="N">N</option>
                      <option value="B">B</option>
                    </select>
                  </div>
                </div>
              ))}
              {lsis.length === 0 && <div className="text-[10px] text-zinc-500">Click + Add LSI (table must have a sort key)</div>}
            </div>
          )}

          <button onClick={doCreateTable} disabled={!newTableName.trim() || !partitionKeyName.trim()} className="btn mt-3 w-full md:w-auto">
            Create Table
          </button>
          <p className="text-[10px] text-zinc-500 mt-1">Uses PAY_PER_REQUEST billing. Creates with the keys you specify. GSIs use ProjectionType ALL.</p>
        </div>

        {tables.length === 0 ? (
          <div className="text-xs text-zinc-500">No tables listed yet. Create one above or click List Tables.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tables.map(t => (
              <button
                key={t}
                onClick={() => selectTable(t)}
                className={`px-3 py-1 rounded text-sm border ${selectedTable === t ? 'bg-zinc-800 border-zinc-500' : 'border-zinc-700 hover:bg-zinc-900'}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Items Table (full width) */}
      {(selectedTable || putTable) && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-sm">Items in <span className="font-mono text-emerald-400">{selectedTable || putTable}</span></div>
            <div className="flex gap-2">
              <button 
                onClick={() => { setIsQueryMode(false); if (selectedTable) scanTableForTable(selectedTable) }} 
                className={`btn text-xs flex items-center gap-1.5 ${!isQueryMode ? '' : 'opacity-70'}`}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Scan
              </button>
              <button 
                onClick={() => setIsQueryMode(true)} 
                className={`btn text-xs flex items-center gap-1.5 ${isQueryMode ? '' : 'opacity-70'}`}
              >
                Query
              </button>
            </div>
          </div>

          {/* Query form (when in query mode) */}
          {isQueryMode && (
            <div className="mb-3 p-2 border border-zinc-700 rounded text-xs">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                <div>
                  <label className="text-[10px] text-zinc-400">Index</label>
                  <select 
                    className="input w-full mt-0.5 text-xs" 
                    value={selectedQueryTarget} 
                    onChange={e => setSelectedQueryTarget(e.target.value)}
                  >
                    {queryTargets.map((t: any) => (
                      <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] text-zinc-400">
                    Partition Key ({currentQueryTarget?.pk || 'pk'})
                  </label>
                  <input 
                    className="input w-full mt-0.5 text-xs" 
                    placeholder="value" 
                    value={queryPartitionValue} 
                    onChange={e => setQueryPartitionValue(e.target.value)} 
                  />
                </div>
                {currentQueryTarget?.sk && (
                  <>
                    <div>
                      <label className="text-[10px] text-zinc-400">Sort Key Condition</label>
                      <select 
                        className="input w-full mt-0.5 text-xs" 
                        value={querySortCondition} 
                        onChange={e => setQuerySortCondition(e.target.value as any)}
                      >
                        <option value="=">=</option>
                        <option value="begins_with">begins_with</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400">Sort Key Value</label>
                      <input 
                        className="input w-full mt-0.5 text-xs" 
                        placeholder="value" 
                        value={querySortValue} 
                        onChange={e => setQuerySortValue(e.target.value)} 
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={executeQuery} className="btn text-xs">Execute Query</button>
                <button onClick={() => { setIsQueryMode(false); if (selectedTable) scanTableForTable(selectedTable) }} className="btn text-xs">Cancel</button>
              </div>
            </div>
          )}

          {/* Horizontally scrollable table with sticky key column + actions on right */}
          <div className="overflow-x-auto border border-zinc-800 rounded">
            <table className="min-w-max text-xs">
              <thead className="bg-zinc-900 text-zinc-400 sticky top-0 z-10">
                <tr>
                  {columns.map((col: string, index: number) => {
                    const isFirstKey = index === 0
                    return (
                      <th
                        key={col}
                        className={`text-left px-2 py-1 border-r border-zinc-700 last:border-r-0 whitespace-nowrap
                          ${isFirstKey ? 'sticky left-0 z-20 bg-zinc-900' : ''}
                        `}
                      >
                        {col}
                      </th>
                    )
                  })}
                  <th className="sticky right-0 z-20 bg-zinc-900 px-2 py-1 w-28 text-center border-l border-zinc-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(columns.length, 1) + 1} className="px-2 py-2 text-zinc-500">
                      No items scanned yet
                    </td>
                  </tr>
                )}
                {items.map((rawItem: any, idx: number) => {
                  const plain: Record<string, any> = {}
                  Object.entries(rawItem).forEach(([k, v]: [string, any]) => {
                    if (v && typeof v === 'object') {
                      if ('S' in v) plain[k] = v.S
                      else if ('N' in v) plain[k] = v.N
                      else if ('BOOL' in v) plain[k] = v.BOOL
                      else if ('NULL' in v) plain[k] = null
                      else plain[k] = v // fallback
                    } else {
                      plain[k] = v
                    }
                  })

                  return (
                    <tr key={idx} className="border-t border-zinc-800 hover:bg-zinc-950">
                      {columns.map((col: string, index: number) => {
                        const isFirstKey = index === 0
                        const isKeyColumn = keyNames.includes(col)
                        const value = plain[col] !== undefined && plain[col] !== null ? String(plain[col]) : ''
                        const copyValue = async () => {
                          if (value) {
                            await navigator.clipboard.writeText(value)
                            toast.success(`Copied ${col} to clipboard`)
                          }
                        }
                        return (
                          <td
                            key={col}
                            onClick={isKeyColumn ? copyValue : undefined}
                            className={`px-2 py-1 font-mono text-[10px] break-all border-r border-zinc-700 last:border-r-0
                              ${isFirstKey ? 'sticky left-0 z-20 bg-zinc-950' : ''}
                              ${isKeyColumn ? 'cursor-pointer hover:underline hover:bg-zinc-900' : ''}
                              max-w-[220px] truncate
                            `}
                            title={value || ''}
                          >
                            {value}
                          </td>
                        )
                      })}
                      <td className="px-2 py-1 sticky right-0 z-20 bg-zinc-950 border-l border-zinc-700 w-28 text-center">
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => openItemModal('view', rawItem)}
                            className="btn px-1.5 py-0.5 text-xs flex items-center gap-1"
                            title="View item"
                          >
                            <Eye className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => openItemModal('edit', rawItem)}
                            className="btn px-1.5 py-0.5 text-xs flex items-center gap-1"
                            title="Edit item"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => openItemModal('delete', rawItem)}
                            className="btn px-1.5 py-0.5 text-xs flex items-center gap-1 text-red-400 hover:text-red-300"
                            title="Delete item"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Put Item form moved below the items table for more space */}
      {(selectedTable || putTable) && (
        <div className="card p-4 mb-4">
          <div className="font-medium text-sm mb-2 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Put Item
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400">Table Name</label>
              <input
                className="input w-full mt-1 font-mono"
                value={putTable}
                onChange={e => setPutTable(e.target.value)}
                placeholder={selectedTable || 'MyTable'}
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400">Item (DynamoDB JSON format)</label>
              <textarea
                className="input w-full mt-1 font-mono text-xs h-48"
                value={itemJson}
                onChange={e => setItemJson(e.target.value)}
              />
              <p className="text-[10px] text-zinc-500 mt-1">Use DynamoDB JSON (e.g. <code>{"{ \"id\": { \"S\": \"abc\" } }"}</code>). Large/complex items will suggest a file placeholder in the CLI.</p>
            </div>

            <button onClick={doPutItem} className="btn w-full">Execute PutItem</button>
          </div>
        </div>
      )}

      {lastCli && (
        <CliCommand
          command={lastCli.command}
          instructions={lastCli.instructions}
          defaultOpen={true}
          title="Equivalent AWS CLI command (DynamoDB)"
        />
      )}

      {/* Item Modal: View (readonly), Edit (editable), Delete (readonly + confirm) */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={closeModal}>
          <div 
            className="card w-full max-w-2xl mx-4 p-4 max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="font-medium">
                {modal.mode === 'view' && 'View Item'}
                {modal.mode === 'edit' && 'Edit Item'}
                {modal.mode === 'delete' && 'Confirm Delete Item'}
              </div>
              <button onClick={closeModal} className="text-xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-auto mb-3">
              <textarea
                value={modalJson}
                onChange={(e) => modal.mode === 'edit' && setModalJson(e.target.value)}
                readOnly={modal.mode !== 'edit'}
                className={`input w-full h-80 font-mono text-xs resize-y ${modal.mode === 'edit' ? '' : 'bg-zinc-950'}`}
                spellCheck={false}
              />
            </div>

            <div className="flex gap-2 justify-end">
              {modal.mode === 'delete' ? (
                <button 
                  onClick={confirmDelete} 
                  className="btn bg-red-600 hover:bg-red-500 border-red-500 text-white px-4"
                >
                  Confirm Delete
                </button>
              ) : modal.mode === 'edit' ? (
                <button onClick={saveEdit} className="btn px-4">
                  Save Changes
                </button>
              ) : null}

              <button onClick={closeModal} className="btn">
                Close
              </button>
            </div>

            <div className="text-[10px] text-zinc-500 mt-2">
              {modal.mode === 'delete' 
                ? 'This will permanently delete the item from the table.' 
                : modal.mode === 'edit' 
                  ? 'Edit the JSON above and click Save. Changes will be written via PutItem.' 
                  : 'Read-only view of the item.'}
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 text-xs text-zinc-500">
        PutItem and Scan use the real DynamoDB client against your configured endpoint. The generated command will use <code>file://item.json</code> for bigger payloads.
      </div>
    </div>
  )
}
