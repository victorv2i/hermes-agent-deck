import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Shield, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * DmAuthPanel — who may DM your bot. Pairing approval is owner-gated BY DESIGN
 * in Hermes: a stranger DMs the bot, Hermes hands them a pairing code, and only
 * the owner approves it. The deck's Connections > Pairing tab drives that
 * approval through the BFF (POST /api/pairing/approve), so this panel points
 * there instead of printing terminal commands.
 */
export function DmAuthPanel() {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} role="region" aria-label="Direct message authorization">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="ad-surface grid size-9 shrink-0 place-items-center rounded-md bg-muted text-foreground-tertiary"
            >
              <ShieldCheck className="size-[18px]" />
            </span>
            <CardTitle id={titleId}>Approve people who DM your agent</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="-mt-1 flex flex-col gap-4">
          <p className="text-13 leading-relaxed text-muted-foreground">
            When someone messages your agent for the first time, your agent gives them a pairing
            code. Review and approve those requests on the Pairing tab. Only you, the owner, can
            approve a request. There&apos;s no auto-approve on purpose.
          </p>
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link to="/connections?tab=pairing">
              <Shield aria-hidden />
              Open the Pairing tab
            </Link>
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}
