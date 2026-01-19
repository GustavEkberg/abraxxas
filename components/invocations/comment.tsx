import { formatDistanceToNow } from 'date-fns'

interface CommentProps {
  content: string
  isAgentComment: boolean
  agentName?: string | null
  userName?: string | null
  createdAt: Date
}

/**
 * Comment component with user/agent styling.
 * User comments: purple accent, left-aligned
 * Agent comments: cyan accent, right-aligned
 */
export function Comment({ content, isAgentComment, agentName, userName, createdAt }: CommentProps) {
  const displayName = isAgentComment ? agentName || 'Abraxas' : userName || 'User'

  return (
    <div className={`flex ${isAgentComment ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-lg p-4 ${
          isAgentComment
            ? 'bg-cyan-950/30 border border-cyan-500/20'
            : 'bg-purple-950/30 border border-purple-500/20'
        }`}
      >
        {/* Author and timestamp */}
        <div className="mb-2 flex items-center gap-2">
          <span
            className={`text-sm font-medium ${
              isAgentComment ? 'text-cyan-400' : 'text-purple-400'
            }`}
          >
            {displayName}
          </span>
          <span className="text-xs text-white/40">
            {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
          </span>
        </div>

        {/* Content */}
        <div className="text-sm text-white/80 whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  )
}
