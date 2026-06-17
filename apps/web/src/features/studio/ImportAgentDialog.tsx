import { useRef, useState, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileUp, Loader2, Upload } from 'lucide-react'
import { PROFILE_ID_RE } from '@agent-deck/protocol'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { useImportStudioProfile } from './hooks'
import { fileToBase64 } from './data/api'

function canonicalizeProfileName(name: string): string {
  return name.trim().toLowerCase()
}

/** Strip the .tar.gz / .tgz suffix to suggest a default agent name from a file. */
function nameFromFile(fileName: string): string {
  return canonicalizeProfileName(
    fileName
      .replace(/\.tar\.gz$/i, '')
      .replace(/\.tgz$/i, '')
      .replace(/[^a-z0-9_-]/gi, '-'),
  )
}

/**
 * ImportAgentDialog - bring an exported agent (a `.tar.gz`) back as a NEW agent.
 * Pick the archive, confirm the new id (pre-filled from the file name), and
 * import. The bytes ride to the BFF as base64; the BFF shells out to the guarded
 * `hermes profile import <tmp> --name <name>`.
 *
 * HONESTY: hermes EXCLUDES credentials from a profile export, so the imported
 * agent starts WITHOUT provider keys - the dialog says so and points to the Env
 * section. On a successful import it opens the new agent's workbench.
 */
export function ImportAgentDialog({
  open,
  onOpenChange,
  existingNames,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The live roster ids, so a colliding target name is caught before the call. */
  existingNames: readonly string[]
}) {
  const navigate = useNavigate()
  const importProfile = useImportStudioProfile()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameId = useId()
  const errId = useId()

  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  // True once the user has edited the name, so we stop auto-syncing it from the file.
  const [nameTouched, setNameTouched] = useState(false)

  const canonicalName = canonicalizeProfileName(name)
  const reserved = canonicalName === 'default'
  const collides = existingNames.includes(canonicalName)
  const nameValid = PROFILE_ID_RE.test(canonicalName) && !reserved && !collides
  const showNameError = name.trim().length > 0 && !nameValid
  const submitting = importProfile.isPending
  const canSubmit = !!file && nameValid && !submitting

  function reset() {
    setFile(null)
    setName('')
    setNameTouched(false)
    importProfile.reset()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    setFile(picked)
    // Suggest a name from the file unless the user already typed their own.
    if (picked && !nameTouched) setName(nameFromFile(picked.name))
  }

  async function handleImport() {
    if (!canSubmit || !file) return
    try {
      const archiveBase64 = await fileToBase64(file)
      const created = await importProfile.mutateAsync({ name: canonicalName, archiveBase64 })
      handleOpenChange(false)
      // Open the new agent; a thin success toast (no birth ceremony - it's an import).
      toast.success(`Imported ${created.name}`, {
        description: 'Re-add provider keys in the Env section, then restart your agent.',
      })
      navigate(`/profiles/${encodeURIComponent(created.name)}`)
    } catch (err) {
      toast.error("Couldn't import the agent", {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import an agent</DialogTitle>
          <DialogDescription>
            Bring an exported agent back from a .tar.gz archive as a new agent.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleImport()
          }}
          className="grid gap-5"
        >
          <div className="grid gap-2">
            <span className="ad-section-label">Archive</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".tar.gz,.tgz,application/gzip,application/x-gzip"
              onChange={onFileChange}
              data-testid="studio-import-file"
              className="sr-only"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="justify-start font-normal"
            >
              <FileUp className="size-4" aria-hidden />
              {file ? (
                <span className="truncate font-mono text-13">{file.name}</span>
              ) : (
                <span className="text-foreground-tertiary">Choose a .tar.gz file…</span>
              )}
            </Button>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={nameId} className="ad-section-label">
              New agent id
            </label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameTouched(true)
              }}
              placeholder="imported-agent"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={showNameError || undefined}
              aria-describedby={showNameError ? errId : undefined}
            />
            {showNameError && (
              <p id={errId} role="alert" className="text-xs text-destructive">
                {reserved
                  ? 'Default is your built-in agent. Pick another id.'
                  : collides
                    ? 'An agent with that id already exists. Pick another.'
                    : 'Use letters, numbers, - or _ (start with a letter or number). Saved lowercase.'}
              </p>
            )}
          </div>

          {/* Honest note: credentials are NOT in the archive. */}
          <p className="text-xs leading-relaxed text-foreground-tertiary">
            Provider keys are not included in an export. After importing, add them in the agent&apos;s
            Env section.
          </p>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} data-testid="studio-import-submit">
              {submitting ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Upload className="size-4" aria-hidden />
              )}
              Import agent
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
