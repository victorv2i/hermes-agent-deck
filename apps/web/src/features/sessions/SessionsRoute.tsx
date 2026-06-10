import { useNavigate, useParams } from 'react-router-dom'
import { CHAT_PATH } from '@/app/navigation'
import { SessionHistoryView } from './SessionHistory'
import { useSession, useSessionMessages } from './hooks'

/**
 * The History route element — mounted at `/sessions/:id`. Loads the session's
 * detail + transcript via TanStack Query and renders {@link SessionHistoryView}.
 *
 * "Continue" resume contract (decoupled from the chat layer so no shared file is
 * edited here): on Continue we navigate to the Chat surface with the session id
 * in `?continue=<id>`. The integrator wires the Chat route to read that param
 * and start a `/chat-run` run carrying `session_id`, so the gateway resumes IN
 * THE SAME hermes session. See WIRING.md.
 */
export function SessionsRoute() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const sessionId = id ?? null
  const detail = useSession(sessionId)
  const messages = useSessionMessages(sessionId)

  return (
    <SessionHistoryView
      detail={detail.data ?? null}
      messages={messages.data?.messages ?? []}
      isLoading={detail.isLoading || messages.isLoading}
      error={detail.isError || messages.isError ? 'error' : null}
      onContinue={(continueId) => {
        navigate(`${CHAT_PATH}?continue=${encodeURIComponent(continueId)}`)
      }}
      // Back to the History browser (the session list). The IA cleanup renamed
      // that surface's route /chats → /history (stream A); this is its end-state.
      onBack={() => navigate('/history')}
    />
  )
}
