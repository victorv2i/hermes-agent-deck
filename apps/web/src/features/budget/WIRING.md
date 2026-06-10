# Budget (Cost Cockpit): wiring

One-line: an optional, client-side **soft** spend budget that WARNS (never stops) when today's or this-month's spend crosses a user-set cap. Pure local feature: no server, no new route, LOCAL-ONLY.

## What ships

- `budgetStore.ts`: a self-contained localStorage store (`agent-deck-budget`, `useSyncExternalStore`), mirroring `settings/density.ts`. Holds `{ daily: number|null, monthly: number|null }`, both unset by default.
- `budgetAlert.ts`: pure breach detection + a once-per-breach session-latch helper (keys on period · cap · day/month bucket, so raising the cap or a new day re-arms).
- `useBudgetAlerts.ts`: the headless watcher. On each usage poll (shares the pill's `days=1` query via react-query cache), it raises ONE calm `toast.warning` with a "Go to Usage" action per fresh breach. Honest copy: it warns, it cannot stop a CLI / Telegram / cron run.

## Already wired in this lane (no integrator action needed)

- **App.tsx**: renders `<LiveBurnRate/>` as the header `headerAccessory`, and mounts the headless `<BudgetAlerts/>` (calls `useBudgetAlerts()`).
- **SettingsPage.tsx**: renders `<BudgetControl/>` (the "Cost" preferences group) under the other editable controls.
- **UsagePage.tsx**: renders `<CostInsights/>` (spend trend + cost-share by model + efficiency nudge).

## Tokens / governance

- The budget-crossed state uses the **`--warning`** semantic STATUS token (warm amber, not destructive red). The action accent (`--primary`) is NOT spent on budget data; it stays reserved for action/active state per the design language.
- Spend magnitude bars/line use `--chart-2` (decorative teal). The efficiency nudge is a neutral info note.
- All token-driven, so it works across every theme.

## Dependencies

- Reuses the existing Usage BFF (`GET /api/agent-deck/usage` → `daily`/`byModel` with `estimatedCost`/`actualCost`). No new endpoints.
