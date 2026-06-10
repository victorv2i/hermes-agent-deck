/**
 * Pure board-snapshot transform for an OPTIMISTIC card move. Given the current
 * board envelope, a card id, and a target column, it returns a NEW envelope with
 * the card relocated to the target column (and its `column` field updated), so the
 * board re-renders the move instantly while the real write is in flight. The
 * caller ({@link useMoveTask}) stashes the prior snapshot and restores it verbatim
 * if the backend refuses — this function never decides success, it only previews.
 *
 * Kept pure + side-effect-free (no cache, no fetch) so the column bookkeeping is
 * trivially unit-tested and the hook stays a thin orchestration shell.
 */
import type { KanbanBoardResponse, KanbanCard, KanbanColumnName } from '@agent-deck/protocol'

/**
 * Relocate `id` to `target`, returning a fresh envelope. No-ops (returns an equal
 * fresh snapshot) when the card is missing or already in `target`; passes an
 * `available:false` envelope through unchanged.
 */
export function applyOptimisticMove(
  board: KanbanBoardResponse,
  id: string,
  target: KanbanColumnName,
): KanbanBoardResponse {
  if (board.available === false) return board

  // Find the card so we can copy it with an updated column. If it isn't on the
  // board (stale id), return the snapshot unchanged.
  let moved: KanbanCard | undefined
  for (const col of board.data.columns) {
    const found = col.cards.find((c) => c.id === id)
    if (found) {
      moved = found
      break
    }
  }
  if (!moved || moved.column === target) return board

  const relocated: KanbanCard = { ...moved, column: target }
  const columns = board.data.columns.map((col) => {
    if (col.name === target) {
      return { ...col, cards: [relocated, ...col.cards.filter((c) => c.id !== id)] }
    }
    return { ...col, cards: col.cards.filter((c) => c.id !== id) }
  })

  return { available: true, data: { ...board.data, columns } }
}
