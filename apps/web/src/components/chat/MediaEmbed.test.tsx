import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { MediaEmbed } from './MediaEmbed'
import { classifyMedia } from './mediaClassify'

function renderEmbed(href: string | undefined, text = 'link text') {
  return render(
    <ThemeProvider>
      <MediaEmbed href={href}>{text}</MediaEmbed>
    </ThemeProvider>,
  )
}

describe('classifyMedia', () => {
  it('classifies audio extensions', () => {
    for (const ext of ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']) {
      expect(classifyMedia(`https://x.test/a.${ext}`)).toBe('audio')
    }
  })
  it('classifies video extensions', () => {
    for (const ext of ['mp4', 'webm', 'mov', 'm4v', 'ogv']) {
      expect(classifyMedia(`https://x.test/v.${ext}`)).toBe('video')
    }
  })
  it('classifies by MIME for data: URLs', () => {
    expect(classifyMedia('data:audio/mp3;base64,AAA')).toBe('audio')
    expect(classifyMedia('data:video/mp4;base64,AAA')).toBe('video')
    expect(classifyMedia('data:image/png;base64,AAA')).toBe('image')
  })
  it('ignores query/hash suffixes', () => {
    expect(classifyMedia('https://x.test/a.mp3?token=1')).toBe('audio')
    expect(classifyMedia('https://x.test/v.mp4?token=1')).toBe('video')
    expect(classifyMedia('https://x.test/v.mp4#t=10')).toBe('video')
  })
  it('treats an extension in the query/hash as a normal link, not media', () => {
    // The extension lives in ?file=… / ?download=…, not the pathname, so the
    // link points at an HTML page — embedding a <video>/<audio> would be dead.
    expect(classifyMedia('https://example.com/page?file=clip.mp4')).toBeNull()
    expect(classifyMedia('https://x/y?download=song.mp3')).toBeNull()
    expect(classifyMedia('https://example.com/page#clip.mp4')).toBeNull()
  })
  it('returns null for non-media links', () => {
    expect(classifyMedia('https://example.com/page')).toBeNull()
    expect(classifyMedia('mailto:a@b.com')).toBeNull()
    expect(classifyMedia('')).toBeNull()
  })
})

describe('MediaEmbed', () => {
  it('embeds an http(s) audio link as <audio controls preload=metadata>', () => {
    renderEmbed('https://x.test/clip.mp3', 'the recording')
    const audio = screen.getByLabelText('the recording')
    expect(audio.tagName.toLowerCase()).toBe('audio')
    expect(audio).toHaveAttribute('controls')
    expect(audio).toHaveAttribute('preload', 'metadata')
    expect(audio).toHaveAttribute('src', 'https://x.test/clip.mp3')
  })

  it('embeds a video link as a constrained <video controls playsInline>', () => {
    renderEmbed('https://x.test/demo.mp4', 'the demo')
    const video = screen.getByLabelText('the demo')
    expect(video.tagName.toLowerCase()).toBe('video')
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video.className).toMatch(/max-h-/)
  })

  it('plays a data: audio source directly', () => {
    renderEmbed('data:audio/wav;base64,AAAA', 'inline sound')
    const audio = screen.getByLabelText('inline sound')
    expect(audio.tagName.toLowerCase()).toBe('audio')
    expect(audio).toHaveAttribute('src', 'data:audio/wav;base64,AAAA')
  })

  it('falls back to an honest open-link for an un-fetchable workspace:// media URL', () => {
    // No in-app route serves workspace:// media — we must NOT point a player at it.
    renderEmbed('workspace://out/render.mp4', 'rendered clip')
    expect(screen.queryByLabelText('rendered clip')).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: /rendered clip/i })
    expect(link).toHaveAttribute('href', 'workspace://out/render.mp4')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('passes a normal (non-media) link straight through to a chat link', () => {
    // A host-local URL keeps PreviewLink's in-app preview affordance, which is
    // the distinctive marker that MediaEmbed delegated to the chat link.
    renderEmbed('http://localhost:3000/article', 'an article')
    // PreviewLink renders the primary link + a new-tab escape; the visible text
    // is preserved and no media element appears.
    expect(screen.queryByLabelText('an article')).not.toBeInTheDocument()
    expect(screen.getByText('an article')).toBeInTheDocument()
    expect(screen.getByTestId('preview-link')).toBeInTheDocument()
  })

  it('embeds a markdown LINK to a data:image inline', () => {
    renderEmbed('data:image/png;base64,AAAA', 'a picture')
    expect(screen.getByRole('img', { name: 'a picture' })).toBeInTheDocument()
  })

  it('treats a plain image-file link (.png) as a normal link, not an embed', () => {
    // Images arrive via the markdown `img` renderer (![]()); a bare LINK to a
    // .png stays a normal link so we don't second-guess the author's intent.
    renderEmbed('https://x.test/pic.png', 'a picture')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('a picture')).toBeInTheDocument()
  })
})
