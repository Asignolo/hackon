import { extractPageLinks, MAX_PAGE_LINKS, MAX_PAGE_LINK_TEXT_LENGTH } from '../links'

describe('extractPageLinks', () => {
  it('keeps navigation, footer and icon links outside the article text', () => {
    const result = extractPageLinks(`
      <nav><a href="/contact">Contact <span>us</span></a></nav>
      <main><p>Photography portfolio</p></main>
      <footer>
        <a href="https://instagram.com/studio" aria-label="Instagram"><svg><path /></svg></a>
        <a href="https://facebook.com/studio"><img alt="Facebook" src="icon.png"></a>
      </footer>`, 'https://studio.example/work')
    expect(result).toEqual({ linksTruncated: false, links: [
      { originalHref: '/contact', url: 'https://studio.example/contact', text: 'Contact us' },
      { originalHref: 'https://instagram.com/studio', url: 'https://instagram.com/studio', text: 'Instagram' },
      { originalHref: 'https://facebook.com/studio', url: 'https://facebook.com/studio', text: 'Facebook' },
    ] })
  })

  it('resolves against the observed final page URL and first base href, preserving meaningful fragments and parameters', () => {
    const result = extractPageLinks(`
      <head><base href="/portfolio/"><base href="https://ignored.example/"></head>
      <a href="contact?place=1&amp;lang=pl#map">Kontakt &amp; mapa</a>
      <a href="#contact">Section</a>
      <a href="//facebook.com/studio">Facebook</a>`, 'https://studio.example/redirected/page')
    expect(result.links).toEqual([
      { originalHref: 'contact?place=1&lang=pl#map', url: 'https://studio.example/portfolio/contact?place=1&lang=pl#map', text: 'Kontakt & mapa' },
      { originalHref: '#contact', url: 'https://studio.example/portfolio/#contact', text: 'Section' },
      { originalHref: '//facebook.com/studio', url: 'https://facebook.com/studio', text: 'Facebook' },
    ])
  })

  it('does not extract hidden template/script anchors or unsafe schemes, credentials and private literals', () => {
    const hrefs = ['', 'javascript:alert(1)', 'mailto:user@example.com', 'data:text/html,hello', 'https://user:secret@example.com/', 'http://127.0.0.1/', 'http://2130706433/', 'http://[::ffff:127.0.0.1]/', 'http://localhost./', 'http://10.0.0.1/', 'https://example.com/' + 'a'.repeat(2048)]
    const html = hrefs.map((href) => `<a href="${href}">unsafe</a>`).join('')
      + '<script><a href="https://script.example">script</a></script><template><a href="/hidden">hidden</a></template>'
    expect(extractPageLinks(html, 'https://studio.example/').links).toEqual([])
  })

  it('deduplicates exact destinations, bounds text and flags an incomplete list', () => {
    const html = '<a href="/same">' + 'x'.repeat(1000) + '</a><a href="https://studio.example/same">duplicate</a>'
      + Array.from({ length: MAX_PAGE_LINKS }, (_, index) => `<a href="/${index}">${index}</a>`).join('')
    const result = extractPageLinks(html, 'https://studio.example/')
    expect(result.links).toHaveLength(MAX_PAGE_LINKS)
    expect(result.links[0].text).toHaveLength(MAX_PAGE_LINK_TEXT_LENGTH)
    expect(result.linksTruncated).toBe(true)
  })

  it('does not truncate a list containing exactly the allowed number of links', () => {
    const html = Array.from({ length: MAX_PAGE_LINKS }, (_, index) => `<a href="/${index}">${index}</a>`).join('')
    expect(extractPageLinks(html, 'https://studio.example/').linksTruncated).toBe(false)
  })

  it('does not invent a public destination for a link resolved against a private base', () => {
    expect(extractPageLinks('<base href="http://localhost/"><a href="contact">Contact</a>', 'https://studio.example/').links)
      .toEqual([])
  })
})
