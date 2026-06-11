import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { fetchModels } from './api'
import {
  ExpensiveModelConfirmDialog,
  type ExpensiveModelConfirm,
} from './ExpensiveModelConfirmDialog'
import { ModelsPage, type ConnectFeature, type SetActiveFeature } from './ModelsPage'
import { useConnectProvider, useModels, useProviderOAuthProviders, useSetModel } from './useModels'

/**
 * Container for the model-selection control. Bridges the `useModels`
 * query to the presentational {@link ModelsPage}, and owns the
 * `useConnectProvider` mutation behind the "Connect a provider" action — passing
 * its real status/result/error down so the dialog reflects the TRUTH (connected,
 * "added but no usable model yet", or a failure) and never a fake success. On
 * success the mutation invalidates the models query so the roster re-checks.
 *
 * Rendered as the "Model" section inside Settings; pass `embedded` so the control
 * drops its full-page chrome and nests under the Settings section header.
 */
export function ModelsRoute({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient()
  const query = useModels()
  const oauthProvidersQuery = useProviderOAuthProviders()
  const connectMutation = useConnectProvider()
  const setModelMutation = useSetModel()
  // The `qualifiedId` of the row whose switch is in flight, so only that row
  // shows the busy state and the others lock out a concurrent switch.
  const [pendingId, setPendingId] = useState<string | undefined>(undefined)

  const onConnect = useCallback(
    (vars: { provider: string; apiKey: string }) => connectMutation.mutate(vars),
    [connectMutation],
  )

  // After a browser OAuth sign-in completes, refresh the roster — the OAUTH
  // mirror of the api-key path's invalidate (fixes the stale-roster bug where a
  // successful sign-in left the model list unchanged). Mirrors ConnectRung.
  const onOAuthConnected = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['agent-deck', 'models'] })
    void qc.invalidateQueries({ queryKey: ['agent-deck', 'provider-oauth'] })
  }, [qc])

  // Re-probe whether the just-OAuthed provider now reports a USABLE model, so the
  // dialog shows the honest verdict instead of declaring success off `logged_in`
  // alone. We re-read the roster directly (a fresh fetch, not a possibly-stale
  // cache) and check for a usable model under that provider.
  const probeOAuthModel = useCallback(async (provider: string) => {
    const slug = provider.trim().toLowerCase()
    const data = await fetchModels()
    return data.models.some(
      (m) =>
        m.usable && (m.provider.toLowerCase() === slug || data.provider.id.toLowerCase() === slug),
    )
  }, [])

  // The gateway's expensive-model guard declined a switch and asked for an
  // explicit confirmation; null = no confirm pending.
  const [expensiveConfirm, setExpensiveConfirm] = useState<ExpensiveModelConfirm | null>(null)

  // "Set as active": switch the active model via the real /model/set proxy. On a
  // REAL switch the mutation invalidates the models query so the active flag re-
  // resolves to the pick; on a gateway rejection we surface an HONEST error toast
  // (the BFF's scrubbed message) — never a silent no-op. When the gateway's
  // expensive-model guard declines with `confirm_required`, nothing switched:
  // the guard's message goes in front of the user (the themed confirm dialog)
  // and only their explicit "Switch anyway" re-posts with the confirm flag.
  const runSetActive = useCallback(
    (vars: { provider: string; model: string }, confirmExpensiveModel: boolean) => {
      setPendingId(`${vars.provider}/${vars.model}`)
      setModelMutation.mutate(
        { ...vars, confirmExpensiveModel },
        {
          onSuccess: (result) => {
            if (result.status === 'confirm-required') {
              // No switch happened (the active model stands) — surface the
              // guard's honest warning and wait for an explicit decision.
              setExpensiveConfirm({ ...vars, message: result.confirmMessage })
              return
            }
            setExpensiveConfirm(null)
            toast.success(`Switched to ${vars.model}`)
          },
          onError: (err) => toast.error('Couldn’t switch the model', { description: err.message }),
          onSettled: () => setPendingId(undefined),
        },
      )
    },
    [setModelMutation],
  )
  const onSetActive = useCallback(
    (vars: { provider: string; model: string }) => runSetActive(vars, false),
    [runSetActive],
  )

  // The explicit "Switch anyway" — the ONLY path that sends the confirm flag.
  const onConfirmExpensive = useCallback(() => {
    if (!expensiveConfirm) return
    runSetActive({ provider: expensiveConfirm.provider, model: expensiveConfirm.model }, true)
  }, [expensiveConfirm, runSetActive])

  // Decline: nothing to revert — the switch never happened, so the page's active
  // flag (from the models query) is still the truth.
  const onCancelExpensive = useCallback(() => setExpensiveConfirm(null), [])

  const setActive: SetActiveFeature = {
    status: setModelMutation.isPending ? 'submitting' : 'idle',
    pendingId,
    onSetActive,
  }

  const onOpenChange = useCallback(
    (open: boolean) => {
      // Closing (or reopening) the dialog clears the previous result/error so a
      // stale verdict never lingers on the next open.
      if (!open || connectMutation.isError || connectMutation.isSuccess) connectMutation.reset()
    },
    [connectMutation],
  )

  const connect: ConnectFeature = {
    status: connectMutation.isPending
      ? 'submitting'
      : connectMutation.isSuccess
        ? 'success'
        : connectMutation.isError
          ? 'error'
          : 'idle',
    result: connectMutation.data,
    error: connectMutation.error?.message,
    onConnect,
    onOpenChange,
    oauthProviders: oauthProvidersQuery.data,
    onOAuthConnected,
    probeOAuthModel,
  }

  if (query.status === 'pending')
    return <ModelsPage status="pending" connect={connect} embedded={embedded} />
  if (query.status === 'error')
    return (
      <ModelsPage
        status="error"
        onRetry={() => query.refetch()}
        connect={connect}
        embedded={embedded}
      />
    )
  return (
    <>
      <ModelsPage
        status="success"
        data={query.data}
        connect={connect}
        setActive={setActive}
        embedded={embedded}
      />
      <ExpensiveModelConfirmDialog
        confirm={expensiveConfirm}
        busy={setModelMutation.isPending}
        onConfirm={onConfirmExpensive}
        onCancel={onCancelExpensive}
      />
    </>
  )
}
