#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')
const placeholder = 'REPLACE-WITH-OWNER'
// Also catch a bare `OWNER` left in a GitHub URL. We standardize on the obvious
// REPLACE-WITH-OWNER token, but a stray `github.com/OWNER/...` would ship a broken
// first command, so flag that pattern too (belt-and-suspenders against recurrence).
const bareOwnerPattern = /github(?:usercontent)?\.com\/OWNER\b/

const publicPlaceholderFilePattern = /^(?:[^/]+\.mdx?|docs\/.+\.(?:md|mdx|json|ya?ml|toml|txt))$/i
const publicMarkdownFilePattern = /^(?:[^/]+\.mdx?|docs\/.+\.mdx?)$/i
// A clean MIT release must not ship docs that claim a restrictive (non-MIT) license
// or commercial-use restriction. This guards against stale licensing language.
const restrictiveLicenseClaimPattern =
  /\b(?:BSL(?:-?1\.1)?|Business Source License|non[- ]?commercial|commercial[- ]use|prohibits commercial|MIT[- ]vs[- ]BSL)\b/i

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: rootDir,
    encoding: 'utf8',
  })

  return output.split('\0').filter(Boolean)
}

function isPublicPlaceholderFile(file) {
  return (
    file === 'README.md' ||
    file === 'install.sh' ||
    file === 'install.ps1' ||
    /^docker\//i.test(file) ||
    /(^|\/)package\.json$/i.test(file) ||
    publicPlaceholderFilePattern.test(file)
  )
}

function isPublicMarkdownFile(file) {
  return publicMarkdownFilePattern.test(file)
}

function readLines(file) {
  return readFileSync(resolve(rootDir, file), 'utf8').split(/\r?\n/)
}

function findPlaceholderBlockers(files) {
  const blockers = []

  for (const file of files.filter(isPublicPlaceholderFile)) {
    const lines = readLines(file)

    lines.forEach((line, index) => {
      if (line.includes(placeholder)) {
        blockers.push({
          file,
          line: index + 1,
          message: `unresolved ${placeholder} public-release placeholder`,
          type: 'placeholder',
        })
      }
      if (bareOwnerPattern.test(line)) {
        blockers.push({
          file,
          line: index + 1,
          message: 'bare `OWNER` placeholder in a GitHub URL (replace with the real org/user)',
          type: 'placeholder',
        })
      }
    })
  }

  return blockers
}

function findRestrictiveLicenseClaims(files) {
  const blockers = []

  for (const file of files.filter(isPublicMarkdownFile)) {
    const lines = readLines(file)

    lines.forEach((line, index) => {
      if (restrictiveLicenseClaimPattern.test(line)) {
        blockers.push({
          file,
          line: index + 1,
          message:
            'restrictive-license or commercial-use claim in a public doc; this is an MIT project',
          type: 'restrictive-license',
        })
      }
    })
  }

  return blockers
}

function plural(count, singular, pluralValue = `${singular}s`) {
  return count === 1 ? singular : pluralValue
}

const trackedFiles = listTrackedFiles()
const placeholderBlockers = findPlaceholderBlockers(trackedFiles)
const licenseBlockers = findRestrictiveLicenseClaims(trackedFiles)
const blockers = [...placeholderBlockers, ...licenseBlockers]

if (blockers.length > 0) {
  console.error(
    `Public readiness check failed: ${blockers.length} ${plural(blockers.length, 'blocker')} found.`,
  )
  console.error('')
  console.error('Blockers:')

  for (const blocker of blockers) {
    console.error(`- ${blocker.file}:${blocker.line} ${blocker.message}`)
  }

  console.error('')
  console.error(
    'No secrets printed: this check reports only tracked public file paths, line numbers, and blocker types.',
  )
  console.error(
    `Summary: ${placeholderBlockers.length} unresolved ${placeholder} ${plural(
      placeholderBlockers.length,
      'placeholder',
    )}; ${licenseBlockers.length} restrictive-license ${plural(
      licenseBlockers.length,
      'claim',
      'claims',
    )}.`,
  )
  process.exitCode = 1
} else {
  console.log('Public readiness check passed.')
  console.log(`Scanned ${trackedFiles.length} tracked files for public-release blockers.`)
  console.log(`No unresolved ${placeholder} placeholders in public docs/install/package files.`)
  console.log('No restrictive-license claims in public markdown.')
}
