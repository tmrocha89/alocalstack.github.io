import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { toast } from 'sonner'

export interface CliCommandProps {
  command: string
  instructions?: string
  defaultOpen?: boolean
  title?: string
}

export function CliCommand({ command, instructions, defaultOpen = false, title = 'Equivalent AWS CLI command' }: CliCommandProps) {
  const [open, setOpen] = useState(defaultOpen)

  const copy = () => {
    navigator.clipboard.writeText(command).then(() => {
      toast.success('Command copied to clipboard')
    })
  }

  return (
    <div className="mt-3 border border-zinc-700 rounded-md bg-zinc-950">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-zinc-900 transition-colors rounded-t-md"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {title}
        </span>
        <span className="text-xs text-zinc-500">click to {open ? 'hide' : 'reveal'}</span>
      </button>

      {open && (
        <div className="p-3 border-t border-zinc-700">
          <pre className="code text-emerald-300 text-xs whitespace-pre-wrap break-all select-all overflow-auto max-h-[180px]">{command}</pre>

          <div className="flex items-center gap-2 mt-2">
            <button onClick={copy} className="btn text-xs flex items-center gap-1.5">
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
          </div>

          {instructions && (
            <div className="mt-2 text-xs text-amber-300 border-l-2 border-amber-600 pl-2 leading-snug">
              {instructions}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
