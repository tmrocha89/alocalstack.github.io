import { useState, useEffect } from 'react'
import { useSettings } from '../lib/settings'
import { generateAwsCli } from '../lib/cli'
import { CliCommand } from '../components/CliCommand'
import { createS3Client } from '../lib/aws'
import { ListBucketsCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, CreateBucketCommand, PutBucketCorsCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { toast } from 'sonner'
import { Upload, Trash2, RefreshCw, Download } from 'lucide-react'

export default function S3Page() {
  const { settings } = useSettings()
  const [buckets, setBuckets] = useState<string[]>([])
  const [selectedBucket, setSelectedBucket] = useState('')
  const [objects, setObjects] = useState<any[]>([])
  const [prefix, setPrefix] = useState('')

  // Upload form state
  const [uploadKey, setUploadKey] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  // Create Bucket
  const [newBucketName, setNewBucketName] = useState('')

  // Create Folder (when bucket selected)
  const [newFolderName, setNewFolderName] = useState('')

  const [lastCli, setLastCli] = useState<{ command: string; instructions?: string } | null>(null)

  async function listBuckets() {
    try {
      const client = createS3Client(settings)
      const res = await client.send(new ListBucketsCommand({}))
      const names = (res.Buckets || []).map(b => b.Name!).filter(Boolean)
      setBuckets(names)
      toast.success(`Listed ${names.length} bucket(s)`)
    } catch (e: any) {
      toast.error('Failed to list buckets', { description: e.message })
    }
  }

  // Auto-list buckets when entering the S3 page
  useEffect(() => {
    listBuckets()
  }, [])

  async function listObjects() {
    if (!selectedBucket) return
    try {
      const client = createS3Client(settings)
      await ensureBucketCors(selectedBucket, client).catch(() => {})
      // Using list-objects-v2 via low level for CLI parity
      const res = await client.send(new ListObjectsV2Command({
        Bucket: selectedBucket,
        Prefix: prefix || undefined,
        MaxKeys: 50,
      }))
      setObjects(res.Contents || [])
      toast.success(`Listed objects in ${selectedBucket}`)
    } catch (e: any) {
      toast.error('Failed to list objects', { description: e.message + ' (CORS issue? Use the Configure CORS button or start LocalStack with EXTRA_CORS_ALLOWED_ORIGINS)' })
    }
  }

  async function doCreateBucket() {
    const name = newBucketName.trim()
    if (!name) {
      toast.error('Enter a bucket name')
      return
    }
    try {
      const client = createS3Client(settings)
      await client.send(new CreateBucketCommand({ Bucket: name }))
      await ensureBucketCors(name, client)
      const cli = generateAwsCli('s3', 'create-bucket', { Bucket: name }, settings)
      setLastCli(cli)
      toast.success(`Bucket ${name} created`)
      setNewBucketName('')
      listBuckets()
    } catch (e: any) {
      toast.error('Failed to create bucket', { description: e.message })
    }
  }

  async function doUpload() {
    if (!selectedBucket || !uploadFile) {
      toast.error('Select bucket and file')
      return
    }

    let key = uploadKey.trim()
    if (!key) {
      key = uploadFile.name
    }

    const isLarge = uploadFile.size > 5 * 1024 * 1024 // 5MB threshold for demo

    try {
      const client = createS3Client(settings)
      await ensureBucketCors(selectedBucket, client)

      // Use ArrayBuffer for maximum browser compatibility with the AWS SDK v3.
      // Passing the raw File/Blob directly can lead to "readableStream.getReader is not a function"
      // errors depending on the bundler/runtime (Vite dev server, certain fetch polyfills, etc.).
      const body = await uploadFile.arrayBuffer()

      await client.send(new PutObjectCommand({
        Bucket: selectedBucket,
        Key: key,
        Body: body,
        ContentLength: uploadFile.size,
        ContentType: uploadFile.type || 'application/octet-stream',
      }))

      const cliParams: any = { Bucket: selectedBucket, Key: key }
      if (isLarge) cliParams.__isLargeOrBinary = true

      const cli = generateAwsCli('s3', 'put-object', cliParams, settings)
      setLastCli(cli)

      toast.success('Object uploaded')
      listObjects() // refresh
    } catch (e: any) {
      const msg = (e?.message || String(e))
      // Only append the CORS guidance for network / preflight style errors.
      const looksLikeCors = /cors|access-control|preflight|origin/i.test(msg)
      const description = looksLikeCors
        ? msg + ' — Check LocalStack CORS (EXTRA_CORS_ALLOWED_ORIGINS and/or bucket policy)'
        : msg
      toast.error('Upload failed', { description })
    }
  }

  async function doDelete(key: string) {
    if (!selectedBucket) return
    try {
      const client = createS3Client(settings)
      await ensureBucketCors(selectedBucket, client)
      await client.send(new DeleteObjectCommand({ Bucket: selectedBucket, Key: key }))

      const cli = generateAwsCli('s3', 'delete-object', { Bucket: selectedBucket, Key: key }, settings)
      setLastCli(cli)

      toast.success(`Deleted ${key}`)
      listObjects()
    } catch (e: any) {
      toast.error('Delete failed', { description: e.message })
    }
  }

  async function downloadObject(key: string) {
    if (!selectedBucket) return
    const client = createS3Client(settings)
    try {
      const response = await client.send(new GetObjectCommand({
        Bucket: selectedBucket,
        Key: key,
      }))

      if (!response.Body) {
        throw new Error('No body in response')
      }

      // Browser-friendly way to consume the stream from the SDK
      const byteArray = await response.Body.transformToByteArray()
      const blob = new Blob([byteArray], {
        type: response.ContentType || 'application/octet-stream',
      })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = key.split('/').pop() || key
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      // Also surface the CLI command for the download
      const cli = generateAwsCli('s3', 'get-object', { Bucket: selectedBucket, Key: key }, settings)
      setLastCli(cli)

      toast.success(`Downloaded ${key}`)
    } catch (e: any) {
      toast.error('Download failed', { description: e.message })
    }
  }

  async function doCreateFolder() {
    if (!selectedBucket) return
    let name = newFolderName.trim()
    if (!name) {
      toast.error('Enter a folder name')
      return
    }
    if (!name.endsWith('/')) name = name + '/'
    try {
      const client = createS3Client(settings)
      await ensureBucketCors(selectedBucket, client)
      await client.send(new PutObjectCommand({
        Bucket: selectedBucket,
        Key: name,
        Body: new Uint8Array(0),
        ContentType: 'application/x-directory',
        // Explicitly avoid checksums for folder marker objects.
        // Combined with the client-level requestChecksumCalculation: 'WHEN_REQUIRED',
        // this prevents LocalStack from hitting internal checksum bugs on empty bodies.
        // (See https://github.com/localstack/localstack/issues with empty PutObject + checksums)
      }))

      const cli = generateAwsCli('s3', 'put-object', { Bucket: selectedBucket, Key: name }, settings)
      setLastCli(cli)

      toast.success(`Folder ${name} created`)
      setNewFolderName('')
      listObjects()
    } catch (e: any) {
      toast.error('Failed to create folder', { description: e.message })
    }
  }

  async function ensureBucketCors(bucket: string, client: ReturnType<typeof createS3Client>) {
    try {
      const origin = window.location.origin
      // Be explicit about headers the modern AWS SDK v3 commonly sends for S3
      // (including checksums for uploads). '*' is good but some LocalStack preflight
      // paths are stricter and benefit from an explicit list.
      const allowedHeaders = [
        '*',
        'authorization',
        'content-type',
        'content-length',
        'x-amz-date',
        'x-amz-security-token',
        'x-amz-content-sha256',
        'x-amz-sdk-checksum-algorithm',
        'x-amz-checksum-algorithm',
        'x-amz-user-agent',
        'amz-sdk-invocation-id',
        'amz-sdk-request',
        'host',
      ]
      await client.send(new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [origin],
              AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD', 'OPTIONS'],
              AllowedHeaders: allowedHeaders,
              ExposeHeaders: ['ETag', 'x-amz-request-id', 'x-amz-server-side-encryption'],
              MaxAgeSeconds: 3000,
            },
          ],
        },
      }))
    } catch (e) {
      // Non-fatal — the top-level EXTRA_CORS_ALLOWED_ORIGINS on LocalStack may be sufficient
      console.debug('Could not set per-bucket CORS policy (may not be needed):', e)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">S3</h2>
      </div>

      {/* Buckets + Create Bucket */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Buckets</div>
          <button onClick={listBuckets} className="btn flex items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4" /> List Buckets
          </button>
        </div>

        {/* Create Bucket form */}
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-zinc-400 block mb-1">Create Bucket</label>
            <input
              className="input w-full"
              placeholder="my-new-bucket"
              value={newBucketName}
              onChange={e => setNewBucketName(e.target.value)}
            />
          </div>
          <button onClick={doCreateBucket} disabled={!newBucketName.trim()} className="btn">
            Create Bucket
          </button>
        </div>

        {buckets.length === 0 ? (
          <div className="text-xs text-zinc-500">No buckets listed yet. Create one above or click List Buckets (real SDK call).</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {buckets.map(b => (
              <button
                key={b}
                onClick={async () => {
                  setSelectedBucket(b)
                  setObjects([])
                  setPrefix('')
                  try {
                    const client = createS3Client(settings)
                    await ensureBucketCors(b, client)
                  } catch {}
                }}
                className={`px-3 py-1 rounded text-sm border ${selectedBucket === b ? 'bg-zinc-800 border-zinc-500' : 'border-zinc-700 hover:bg-zinc-900'}`}
              >
                {b}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Objects + Upload + Create Folder for selected bucket */}
      {selectedBucket && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="font-medium">Bucket: </span>
              <span className="font-mono text-emerald-400">{selectedBucket}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  const client = createS3Client(settings)
                  await ensureBucketCors(selectedBucket, client)
                  toast.success('CORS policy applied to bucket for current browser origin')
                }}
                className="btn text-sm"
                title="Apply a permissive CORS policy on this bucket so browser SDK calls (uploads, folders) work. You may also need EXTRA_CORS_ALLOWED_ORIGINS on the LocalStack container."
              >
                Configure CORS
              </button>
              <input
                className="input w-64 text-sm"
                placeholder="Prefix filter"
                value={prefix}
                onChange={e => setPrefix(e.target.value)}
              />
              <button onClick={listObjects} className="btn text-sm flex items-center gap-1.5">
                <RefreshCw className="h-4 w-4" /> List Objects
              </button>
            </div>
          </div>

          {/* Objects table */}
          <div className="overflow-auto max-h-64 border border-zinc-800 rounded">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="text-left px-3 py-1.5">Key</th>
                  <th className="text-left px-3 py-1.5">Size</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {objects.length === 0 && <tr><td colSpan={3} className="px-3 py-2 text-zinc-500 text-xs">No objects (or list not run yet)</td></tr>}
                {objects.map((obj, i) => (
                  <tr key={i} className="border-t border-zinc-800 hover:bg-zinc-950">
                    <td className="px-3 py-1 font-mono text-xs break-all">{obj.Key}</td>
                    <td className="px-3 py-1 text-xs text-zinc-400">{obj.Size}</td>
                    <td className="px-3 py-1 text-right">
                      <div className="flex gap-2 justify-end items-center">
                        {!obj.Key?.endsWith('/') && (
                          <button
                            onClick={() => downloadObject(obj.Key)}
                            className="text-blue-400 hover:text-blue-300"
                            title="Download"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        )}
                        <button onClick={() => doDelete(obj.Key)} className="text-red-400 hover:text-red-300" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Upload form */}
          <div className="mt-4 pt-4 border-t border-zinc-700">
            <div className="font-medium text-sm mb-2 flex items-center gap-2">
              <Upload className="h-4 w-4" /> Upload object (uses s3api put-object under the hood)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                className="input"
                placeholder="Key / prefix (optional — defaults to filename)"
                value={uploadKey}
                onChange={e => setUploadKey(e.target.value)}
              />
              <input
                type="file"
                className="input file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-sm file:bg-zinc-800 file:text-zinc-200"
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
              />
              <button onClick={doUpload} disabled={!uploadFile} className="btn">
                Upload
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-1">Leave Key empty to upload with the original filename. Large files (&gt; ~5MB) or binary will generate a placeholder command with instructions.</p>
          </div>

          {/* Create Folder */}
          <div className="mt-4 pt-4 border-t border-zinc-700">
            <div className="font-medium text-sm mb-2 flex items-center gap-2">
              Create Folder (S3 prefix)
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <input
                className="input flex-1 min-w-[200px]"
                placeholder="my-folder/"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
              />
              <button onClick={doCreateFolder} disabled={!newFolderName.trim()} className="btn">
                Create Folder
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-1">Creates a 0-byte object with key ending in /. Visible as a folder in most UIs.</p>
          </div>
        </div>
      )}

      {/* CLI reveal for the last S3 action */}
      {lastCli && (
        <CliCommand
          command={lastCli.command}
          instructions={lastCli.instructions}
          defaultOpen={true}
          title="Equivalent AWS CLI command (S3)"
        />
      )}

      <div className="text-xs text-zinc-500 mt-6">
        All operations use the live endpoint/region from the top bar. S3 commands always use the <code>s3api</code> subcommand.
      </div>
    </div>
  )
}
