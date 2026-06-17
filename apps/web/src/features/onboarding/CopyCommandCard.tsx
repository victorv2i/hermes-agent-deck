import { ClipboardCopy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'

/**
 * CopyCommandCard — an HONEST copy-paste command row. The wizard uses it where a
 * step needs an action the BFF genuinely CANNOT drive (for example, the
 * installer can't sense a PATH reload). So the card offers ONLY copy — never a
 * "Run" / "Install" button that would fake a run the server can't actually
 * perform or observe.
 *
 * The verbatim command renders as `code`; the single ghost button copies the
 * EXACT string to the clipboard. No sky-blue action accent (copy is a quiet
 * affordance, not the rung's primary action — Continue/Re-check own that).
 */
export function CopyCommandCard({
  command,
  className,
  ariaLabel,
}: {
  command: string
  className?: string
  /** Optional accessible label for the copy button (defaults to "Copy command"). */
  ariaLabel?: string
}) {
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(command)
      toast.success('Command copied')
    } catch {
      toast.error('Couldn’t copy the command')
    }
  }

  return (
    <div
      className={cn(
        'ad-surface flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-2',
        className,
      )}
    >
      <code
        className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground"
        title={command}
      >
        {command}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={copy}
        aria-label={ariaLabel ?? 'Copy command'}
      >
        <ClipboardCopy aria-hidden />
        Copy
      </Button>
    </div>
  )
}
