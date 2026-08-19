const savedUrl = window.location.href

function playground() {
  return htmx.find('#test-playground')
}

function setupTest() {
  const pg = playground()
  if (pg.hasAttribute('data-navigation-safe')) return

  pg.addEventListener('click', event => {
    const anchor = event.target.closest('a')
    if (anchor?.href && !event.defaultPrevented) event.preventDefault()
  })
  pg.addEventListener('submit', event => {
    if (!event.defaultPrevented) event.preventDefault()
  })
  pg.setAttribute('data-navigation-safe', 'true')
}

async function cleanupTest() {
  const pg = playground()
  await htmx.swap({
    text: '',
    target: pg,
    swap: 'innerHTML',
    sourceElement: pg
  })

  if (window.location.href !== savedUrl) {
    window.history.replaceState(null, '', savedUrl)
  }
}

function createProcessedHTML(html) {
  const pg = playground()
  pg.innerHTML = html
  htmx.process(pg)
  return pg.firstElementChild
}

function wait(milliseconds = 10) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds))
}
