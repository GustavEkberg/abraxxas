import { cn } from '@/lib/utils'

interface GreetingProps {
  className?: string
}

export function Greeting({ className }: GreetingProps) {
  return (
    <div className={cn('text-center text-lg font-medium text-white/80', className)}>
      Welcome to the app!
    </div>
  )
}
