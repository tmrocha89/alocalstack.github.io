import { Link } from 'react-router-dom'
import { Database, HardDrive, MessageSquare, Bell, Zap, Users } from 'lucide-react'

const services = [
  { name: 'S3', path: '/s3', icon: HardDrive, desc: 'Buckets & objects' },
  { name: 'DynamoDB', path: '/dynamodb', icon: Database, desc: 'Tables & items' },
  { name: 'SQS', path: '/sqs', icon: MessageSquare, desc: 'Queues (coming soon)' },
  { name: 'SNS', path: '/sns', icon: Bell, desc: 'Topics (coming soon)' },
  { name: 'Lambda', path: '/lambda', icon: Zap, desc: 'Functions (coming soon)' },
  { name: 'Cognito', path: '/cognito', icon: Users, desc: 'User pools (coming soon)' },
]

export default function Overview() {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Overview</h2>
      <p className="text-sm text-zinc-400 mb-6">Select a service from the left menu or the cards below. Every action you perform will let you reveal the exact CLI command.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {services.map((svc) => {
          const Icon = svc.icon
          const disabled = svc.path.includes('sqs') || svc.path.includes('sns') || svc.path.includes('lambda') || svc.path.includes('cognito')
          return (
            <Link
              key={svc.name}
              to={disabled ? '#' : svc.path}
              className={`card p-4 flex items-start gap-4 hover:border-zinc-600 transition-colors ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <div className="mt-0.5">
                <Icon className="h-6 w-6 text-zinc-400" />
              </div>
              <div>
                <div className="font-medium">{svc.name}</div>
                <div className="text-sm text-zinc-400">{svc.desc}</div>
              </div>
            </Link>
          )
        })}
      </div>

      <div className="mt-8 text-xs text-zinc-500">
        Tip: Change the endpoint/region in the top bar. All generated CLI commands will use the live values.
      </div>
    </div>
  )
}
