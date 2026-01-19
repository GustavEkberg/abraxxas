'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface AddCommentFormProps {
  onSubmit: (content: string) => Promise<void>
}

/**
 * Form for adding comments to tasks.
 * Simple textarea with submit button that clears on success.
 */
export function AddCommentForm({ onSubmit }: AddCommentFormProps) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!content.trim()) {
      return
    }

    setLoading(true)

    try {
      await onSubmit(content)
      // Clear form on successful submit
      setContent('')
    } catch (error) {
      // Error handling is parent's responsibility
      console.error('Failed to submit comment:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Textarea
        placeholder="Add your comment..."
        value={content}
        onChange={e => setContent(e.target.value)}
        disabled={loading}
        rows={3}
        className="border-white/10 bg-zinc-900 text-white/90 placeholder:text-white/40 resize-none"
      />
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={loading || !content.trim()}
          className="bg-purple-600 text-white transition-all duration-200 hover:bg-purple-700 active:scale-95 disabled:opacity-50"
        >
          {loading ? 'Posting...' : 'Post Comment'}
        </Button>
      </div>
    </form>
  )
}
