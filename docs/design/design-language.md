# Agentdeck: Design Language (v1)

> Goal: best-in-class clarity with a distinctive Nous/Hermes soul. A beautifully crafted instrument for thinking *with* your agent, not a SaaS dashboard. Restraint over decoration; the conversation is the hero.

## 1. Vibe
Calm, premium, conversation-first. Mostly whitespace + prose. Nothing crowds the chat. Feels considered, fast, and quietly confident. "Want to use it" comes from: gorgeous typography, buttery micro-motion, zero clutter, and details that respect the user.

## 2. Identity & palette (REFINED: direction A)
Keep the distinctive premium, governed identity; execute it premium. The single
biggest fix was lifting borders and surface separation so elevation is legible.

**A user-selectable THEME (color scheme) is a third design dimension**, orthogonal
to dark/light mode and density (see §10a). The GOVERNANCE below is invariant across
themes; each theme just supplies its own token *values*; the **action accent is
now per-theme** (`--primary`), not hard-wired to one amber. The **default theme is
"Clay & Sky"** (neutral slate + dusty trust-blue accent), a calm, grounded base;
the warm **"Ember Study"** (espresso + amber-gold) and the classic **"Warm Void"
teal are preserved as selectable themes**. Wherever this section names a specific
hex (e.g. amber `#DD8E35`), read it as *that theme's value* of the governed token;
every theme honors the same rule with its own color.

**Default = "Clay & Sky" (dark)**: calm, grounded, premium (the base, lives at
the bare `:root`):
- Base bg `#16181C` (neutral slate). Layered surfaces surface-1 `#1F2228`,
  surface-2 `#282C33`, elevated card `#31363F`. Text `#E6E8EC`. Action accent dusty
  trust-blue `--primary #7BA7D9` (hover `#93B8E4`), a COOL accent. Light variant is
  a warm-neutral daylight (`#F4F2EE`) with the dusty blue deepened to `#2F5C8C` for
  AA. Body fg/bg clears AA in both variants.

**Theme = "Ember Study" (espresso)**: warm, human, lamp-lit (a selectable theme):
- Base bg `#1A1410` (warm espresso-charcoal). Layered surfaces surface-1 `#241C15`,
  surface-2 `#2E241B`, elevated card `#382C21`. Text `#EDE4D4`. Action accent
  amber-gold `--primary #E0892B` (hover `#EFA04A`), a WARM accent. Light variant is
  a warm cream (`#F9F3EA`) with deepened amber `#9C520D`.

**Theme = "Warm Void" (teal)**: the original Nous warm-void, preserved exactly:
- Base bg `#041C1C` (Nous warm-void teal-black).
- **Layered surfaces** (a touch more separation than v1, so elevation reads):
  surface-1 `#07211F`, surface-2 `#0C2A28`, elevated card `#11322F`. `--card`
  and `--popover` use the elevated value; `--muted`/`--accent`/`--secondary` map
  to surface-2; the rail uses surface-1.
- **Text** `#F2EBDD` (primary, warm off-white), `#A9B4AC` (secondary), `#82918A`
  (tertiary, lightened from `#6E7E76` so it clears AA on bg AND cards).
- **Borders are the #1 fix, LIFTED so they're never invisible:**
  default `rgba(242,235,221,0.10)`, elevated/hover `rgba(242,235,221,0.16)`,
  PLUS a subtle 1px inset top highlight on cards `rgba(255,255,255,0.04)`. This
  border + top-highlight pair is the canonical surface look (`.ad-surface`).
- **Accent governance: amber `#DD8E35` (hover BRIGHTENS to `#E9A24D`) means
  PRIMARY ACTION + LIVE/ACTIVE state ONLY.** Active nav = a left amber accent bar
  (`::before`, 3px) + a faint amber-tinted bg + amber row icon. Amber is removed
  from decoration (cost numbers, metric values, etc.). Focus ring, streaming
  caret, and the "active"/"secret" markers are the only other amber uses.
- **Semantic colors (color = meaning), status dots/badges ONLY:**
  success/positive teal-green `#3FB7A0`, error `#E5604D`, warning `#E0A23A`,
  info `#5E9CA8`.

**Light = "Warm Parchment"**: refined to MATCH the dark quality, not an
afterthought:
- Base `#F6F1E7`; layered surfaces surface-1 `#FBF7EE`, surface-2 `#EFE8DA`,
  elevated card `#FFFFFF`. Ink `#1A1714`.
- Amber-as-text/link DEEPENED to `#9C520D` (AA ≥4.5:1 on every light surface);
  vivid `#C9781F` retained for large/non-text accents (charts/rings) only.
- Borders DEEPENED to match the dark theme's lifted hairlines: default
  `rgba(26,23,20,0.14)`, strong `rgba(26,23,20,0.20)`; card top highlight is a
  warm white so the white-on-parchment lift still reads.
- Semantic: success `#177060`, error `#C0392B`, warning `#9A6510`, info `#2F6B78`.

Every theme shares the SAME governance (one action accent, semantic = status,
lifted hairlines). Ship **dark "Clay & Sky" as the default theme**; respect system
preference for light/dark; pick the theme in Settings or ⌘K. NO neon/cyberpunk.

**The four families** (each defines a real dark + light variant, AA body contrast,
governed accent; listed in registry/display order):
`clay-sky` (default; neutral slate + dusty trust-blue) · `ember-study` (warm
espresso + amber-gold) · `warm-void` (Nous teal-black dark + an airy cream
parchment light) · `indigo-atelier` (warm aubergine + indigo-violet). The light/dark
TOGGLE (the app mode) chooses which variant of the chosen family paints. The action
accent per family is dusty-blue / amber / amber / indigo respectively, so the
default accent is COOL, three warm + one cool. (The former standalone
`warm-parchment` is NOT a 5th family: its cream daylight folded in as the LIGHT
mode of the Warm Void family.)

## 3. Typography
- UI: **Inter** (system grotesk fallback): tight, legible, modern.
- Assistant prose: Inter at `line-height 1.7`, `max-width 68ch`: clean and readable (no serif/sans mix in v1).
- Brand wordmark + section glyphs only: **PP Mondwest** (Nous font; falls back to Inter): a tasteful identity nod, never body text.
- Code: **JetBrains Mono** (ui-monospace fallback).
- Scale: 12 · 13 · 14(body) · 16 · 20 · 24 · 30. Body 14px / line-height 1.6;
  assistant prose 1.7 at ~68ch.
- **Section labels** are 11px, uppercase, letter-spaced (0.06em), muted-but-legible
  (`#82918A`). One source of truth: the `.ad-section-label` utility. Used for rail
  group headings (CHAT / WORKSPACE / SYSTEM) and card section titles.

### Radii & spacing
- Radii: cards `14px` (`--radius-xl`), inputs/buttons `9–12px` (`--radius`/`--radius-md`
  band 10–14px; chips/badges `6px`). Never round > 14px.
- Spacing on an 8px rhythm: page padding 24–32px; card padding 16–20px. Generous
  but tight.

## 4. Layout: three zones (calm, conversation-first)
- **Left rail** (~260px, collapsible): profile/model chip · "New chat" · search (⌘K) · session list grouped Today / Yesterday / Earlier; hover-reveal row actions. Slim, quiet.
- **Center (hero)**: the conversation. Content max-width ~720px, centered. Minimal sticky header (session title · model · context-usage ring). Composer floats, pinned bottom.
- **Right drawer** (hidden by default, slides in, ⌘.): context / files / tool detail.
No top nav bar. Everything secondary lives in the rail or drawer.

## 5. Conversation anatomy
- **User turn**: soft surface card, max-width, right-padded; small "you" marker.
- **Assistant turn**: full-width prose, distinguished by spacing + subtle bg, not heavy bubbles.
- **Streaming**: tokens append smoothly; soft amber caret pulses while streaming; auto-scroll with a "jump to latest" pill when scrolled up.
- **Tool calls**: collapsed one-line chips (icon · `Ran tool_name` · result summary · duration); click to expand args/result. Never auto-expand; metadata-colored, quiet.
- **Reasoning/thinking**: elegant collapsible "Thinking" disclosure, subtle amber left-border, collapsed by default.
- **Approvals**: inline card (not modal): Allow once / session / always · Deny; amber-accented, unmissable yet calm.
- **Code**: Shiki-highlighted, rounded, header with language label + copy ("Copied!" feedback). Markdown is a joy: spacing, tables, lists, blockquotes, KaTeX math, Mermaid diagrams.
- Hover: timestamp + copy-message.

## 6. Composer
Floating rounded auto-grow textarea, placeholder "Message your agent…". Left: attach (+). Right: model-selector chip · context-usage ring · send (amber, ⌘/Ctrl+Enter). `/` opens slash-command autocomplete. Stop button replaces send while streaming. Subtle amber focus glow.

## 7. Motion (Framer Motion, restrained)
Message fade+rise (12px, 180ms ease-out) · drawer slide 220ms · streaming caret pulse · hover 120ms · skeleton shimmer for loading. No bounce/excess. Respect `prefers-reduced-motion`.

## 8. Details that make it "want to use"
- **⌘K command palette**: jump to session · new chat · switch model/profile · toggle theme · run slash command.
- **Keyboard**: ⌘K palette · ⌘. drawer · ⌘N new · Esc abort · j/k session nav · ? shortcuts.
- **Empty/first-run**: calm invitation + 3 example prompts.
- **Loading**: skeletons, never spinners-of-doom. **Toasts**: minimal, bottom, auto-dismiss.
- Polished scrollbars, amber selection tint, `focus-visible` rings everywhere.

## 9. Accessibility & quality bar
shadcn/Radix primitives → keyboard + ARIA built in. AA contrast both themes. `focus-visible`. `prefers-reduced-motion`. Semantic HTML. Mobile-responsive (rail collapses to a drawer; composer full-width). Every interactive target ≥40px.

## 10. Tokenization (how it lands in code)
- Tailwind v4 `@theme` CSS variables for the palette + radii; light/dark via
  `data-theme` (+ the `.dark` class toggled by ThemeProvider). The DEFAULT theme
  (Clay & Sky) and all framework `@theme inline` mappings live in
  `apps/web/src/index.css`, the source of truth; the three non-default families
  (Ember Study, Warm Void · Nous, Indigo Atelier) live in
  `apps/web/src/features/themes/palettes.css` (imported by index.css).
- **Token names** (exposed to Tailwind as `--color-*`): `background`, `foreground`,
  `foreground-tertiary`, `surface-1/2/elevated`, `card`, `popover`, `primary`,
  `primary-hover`, `secondary`, `muted`, `accent`, `border`, `border-strong`,
  `input`, `ring`, and semantic `success` / `destructive` / `warning` / `info`.
  Plus raw vars `--card-highlight` (top inset) and `--border-strong`.
- shadcn components themed to these tokens (not default slate). One action accent
  per theme (`--primary`, governed per §2). Lifted hairline borders + 1px top
  highlight, generous radius. **No component reads theme names**; they read these
  CSS variables, so switching a theme requires zero component changes.

### 10a. Theme system (the third design dimension)
A user-selectable color SCHEME, fully orthogonal to dark/light mode and density;
the three compose freely.
- **Mechanism**: a `data-palette="<id>"` attribute on `<html>` selects the theme.
  Each theme defines its tokens for BOTH variants under `[data-palette='<id>']`
  (dark) + `[data-palette='<id>'][data-theme='light']` (light). The **default theme
  (Clay & Sky) lives at the bare `:root`** (+ `:root[data-theme='light']`), so it
  carries NO attribute and the resting DOM is clean; only non-default themes stamp
  `data-palette`. This is the same attribute-less-default pattern as density.
- **Runtime**: `features/themes/palette.ts` is an imperative module store +
  `usePalette()` hook (`useSyncExternalStore`, no Context), mirroring `density.ts`.
  The choice persists to `localStorage['agent-deck-palette']` (separate from the
  mode key `agent-deck-theme`). `features/themes/palette-registry.ts` is the single
  registry (ids, labels, descriptions, swatches).
- **No flash**: an inline guard in `index.html` applies the saved theme before
  paint (mirroring the theme + density guards); its resolution rule is the tested
  `features/themes/prePaint.ts` (default/invalid/unset → no attribute).
- **Pickers**: a live-applying swatch GRID in Settings
  (`features/settings/PaletteControl.tsx`): one labeled swatch tile per family
  (recognition, not a dropdown) plus a colocated light/dark MODE toggle (a governed
  segmented radiogroup that drives the one app-mode source of truth via the
  ThemeProvider, so swatches preview the exact tone they paint), and an
  "Appearance" quick-switch group in the ⌘K command palette. The `/theme` composer
  command still toggles light/dark (mode), not the color scheme.
- **Governance preserved**: every theme defines exactly one `--primary` action
  accent (used only for primary action, active/live state, focus ring, streaming
  caret, thinking dots, tool/approval accents; never decoration), semantic tokens
  for status only, and the lifted hairline + top-highlight surface look. The
  terminal theme (`features/terminal/terminalTheme.ts`) reads the live CSS vars, so
  xterm tracks the active theme automatically.

### Shared primitives (the consistent vocabulary every surface uses)
- **Surface headers are a deliberate TWO-TIER system:** both share the
  amber-tinted framed Lucide tile + heading face so they read as one family, but
  the prominence is matched to the surface:
  - **`PageHeader`** (`components/ui/page-header.tsx`): the header for
    scrollable, centered CONTENT pages (Settings, Models, Profiles, Usage): a
    Lucide LINE icon (never emoji) in a faint amber-tinted framed tile + the
    title at a prominent 24px/medium + an optional muted subtitle + an optional
    right-aligned `actions` slot. Carries its own bottom margin. The prominence
    reads as a calm page title at the top of a centered column.
  - **`SurfaceHeader`** (`components/ui/surface-header.tsx`): the IDENTICAL slim
    treatment for full-bleed TOOL surfaces (Files, Terminal): same tile + heading
    face, but a 16px/medium title in a bordered top bar (no large bottom margin),
    so the working panel below (file tree/preview, live terminal) keeps its
    vertical real estate. Used here instead of PageHeader because a 24px title +
    36px tile + 32px bottom margin would steal a meaningful band from these dense,
    full-height tools and read as oversized chrome atop the instrument. Files and
    Terminal share this exact component (byte-identical by construction); the
    Terminal variant adds a right-aligned connection dot for its backend probe.
- **`Badge`** (governed vocabulary): `active`/`default` (amber, the ONE live/
  active marker; brightens on hover), `muted` (quiet neutral metadata chip),
  `success`/`warning`/`info`/`destructive` (tinted semantic chips), plus structural
  `outline`/`secondary`/`ghost`/`link`. Amber is reserved for `active`.
- **`Card`**: uses `.ad-surface` (lifted border + top highlight). `size="sm"` for
  denser tiles (e.g. `StatCard`).
- **`Button`**: amber `default` that BRIGHTENS to `#E9A24D` on hover (not dim);
  `secondary`, `ghost`, `outline`, `destructive`. Amber focus ring everywhere.
- **`Input`**: amber focus ring.
- **Rail/nav**: group section labels (`.ad-section-label`); the active row gets a
  left amber bar (`::before`) + faint amber tint + amber icon; hover lifts the row.
- Utility classes: `.ad-surface` / `.ad-surface-hover` (elevation), `.ad-section-label`
  (11px caps), `.ad-prose` (assistant markdown), `.ad-caret` (streaming caret).
- A small `<Markdown>` renderer (react-markdown + Shiki + KaTeX + Mermaid) and a
  `<ToolCard>` / `<ReasoningBlock>` / `<ApprovalCard>` component set are the chat's
  reusable vocabulary.
