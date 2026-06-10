import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.resolve(here, '..')
const runtimeExtensions = new Set(['.ts', '.tsx', '.css'])
const excludedDirectories = new Set(['__tests__', 'test'])
const bannedGlassPatterns = [
  { label: 'Tailwind backdrop-blur utility', pattern: /\bbackdrop-blur(?:-[\w/.[\]:]+)?\b/ },
  { label: 'CSS backdrop-filter property', pattern: /\bbackdrop-filter\b/ },
  { label: 'React style backdropFilter property', pattern: /\bbackdropFilter\b/ },
]

function runtimeSourceFiles(directory: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        files.push(...runtimeSourceFiles(absolutePath))
      }
      continue
    }

    if (!entry.isFile()) continue
    if (!runtimeExtensions.has(path.extname(entry.name))) continue
    if (/\.(test|spec)\.[cm]?[tj]sx?$/.test(entry.name)) continue

    files.push(absolutePath)
  }

  return files
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('design spine guard rails', () => {
  it('keeps runtime source free of glassmorphism/backdrop blur', () => {
    const offenders = runtimeSourceFiles(srcRoot).flatMap((file) => {
      const relativePath = path.relative(srcRoot, file)
      return withoutComments(readFileSync(file, 'utf8'))
        .split('\n')
        .flatMap((line, index) =>
          bannedGlassPatterns.flatMap(({ label, pattern }) =>
            pattern.test(line) ? [`${relativePath}:${index + 1} (${label})`] : [],
          ),
        )
    })

    expect(
      offenders,
      `Glassmorphism is banned by the design spine; remove backdrop blur from:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
