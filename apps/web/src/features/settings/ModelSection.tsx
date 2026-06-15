import { ModelsRoute } from '@/features/models/ModelsRoute'

/**
 * The "Model" section on the Settings surface — the model-selection control
 * (active-model picker + provider connect + the auxiliary/task model assignments)
 * folded in from the retired standalone `/models` page. It renders the SAME
 * control (`ModelsRoute`, fed by the same `useModels`/`useSetModel` hooks over the
 * same `/api/agent-deck/models` + `/api/model/set` routes) in `embedded` mode, so
 * it nests under this section header instead of carrying its own page chrome.
 *
 * Anchored by `id="model"` so the read-only config dump's "Active model" pointer
 * can scroll the user straight to where the model is actually changed.
 */
export function ModelSection() {
  return (
    <section id="model" aria-label="Model" className="scroll-mt-6">
      <div className="mb-3">
        <h2 className="ad-section-label">Model</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The models your agent can use. The checked model is the default for new conversations.
        </p>
      </div>
      {/* A subtle container so the embedded picker reads as a real section card
          rather than floating loose under the header (matches the other Settings
          surfaces' ad-surface treatment, kept quieter on surface-1). */}
      <div className="ad-surface ad-raised rounded-xl bg-surface-1 p-4">
        <ModelsRoute embedded />
      </div>
    </section>
  )
}
