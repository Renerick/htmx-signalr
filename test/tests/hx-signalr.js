describe('hx-signalr extension', function () {
  let defaultPrefix
  let defaultSignalRConfig
  let mockHubConnections
  let mockBuilders
  let originalConsoleError

  class MockHubConnection {
    static nextId = 1

    constructor(url) {
      this.url = url
      this.connectionId = `connection-${MockHubConnection.nextId++}`
      this.state = 'Disconnected'
      this.handlers = new Map()
      this.sentMessages = []
      this.startCalls = 0
      this.stopCalls = 0
      this.lifecycleHandlers = {}
    }

    start() {
      this.startCalls++
      this.state = 'Connected'
      return Promise.resolve()
    }

    stop() {
      this.stopCalls++
      this.state = 'Disconnected'
      this.lifecycleHandlers.close?.()
      return Promise.resolve()
    }

    send(method, message) {
      if (this.state !== 'Connected') return Promise.reject(new Error('Connection not connected'))
      this.sentMessages.push({ method, message })
      return Promise.resolve()
    }

    on(method, handler) {
      method = method.toLowerCase()
      if (!this.handlers.has(method)) this.handlers.set(method, [])
      this.handlers.get(method).push(handler)
    }

    off(method, handler) {
      method = method.toLowerCase()
      const handlers = this.handlers.get(method) || []
      this.handlers.set(method, handler === undefined
        ? []
        : handlers.filter(candidate => candidate !== handler))
    }

    onreconnecting(handler) {
      this.lifecycleHandlers.reconnecting = handler
    }

    onreconnected(handler) {
      this.lifecycleHandlers.reconnected = handler
    }

    onclose(handler) {
      this.lifecycleHandlers.close = handler
    }

    emit(method, message) {
      method = method.toLowerCase()
      return Promise.all([...(this.handlers.get(method) || [])].map(handler => handler(message)))
    }

    reconnecting(error) {
      this.state = 'Reconnecting'
      this.lifecycleHandlers.reconnecting(error)
    }

    reconnected(connectionId) {
      this.state = 'Connected'
      this.lifecycleHandlers.reconnected(connectionId)
    }

    close(error) {
      this.state = 'Disconnected'
      this.lifecycleHandlers.close(error)
    }
  }

  class MockHubConnectionBuilder {
    constructor() {
      this.options = {}
      mockBuilders.push(this)
    }

    configureLogging(level) {
      this.options.logging = level
      return this
    }

    withUrl(url, options) {
      this.options.url = url
      if (options !== undefined) this.options.urlOptions = options
      return this
    }

    withAutomaticReconnect(retryPolicy) {
      this.options.automaticReconnect = retryPolicy === undefined ? true : retryPolicy
      return this
    }

    build() {
      const connection = new MockHubConnection(this.options.url)
      connection.builderOptions = { ...this.options }
      mockHubConnections.push(connection)
      return connection
    }
  }

  function installSignalRMock() {
    window.signalR = {
      HubConnectionBuilder: MockHubConnectionBuilder,
      HubConnectionState: {
        Disconnected: 'Disconnected',
        Connecting: 'Connecting',
        Connected: 'Connected',
        Disconnecting: 'Disconnecting',
        Reconnecting: 'Reconnecting'
      }
    }
  }

  function suppressConsoleError() {
    console.error = function () { }
  }

  before(function () {
    defaultPrefix = htmx.config.prefix
    defaultSignalRConfig = { ...htmx.config.signalr }
  })

  beforeEach(function () {
    originalConsoleError = console.error
    setupTest()
    MockHubConnection.nextId = 1
    mockHubConnections = []
    mockBuilders = []
    installSignalRMock()
    htmx.config.prefix = defaultPrefix
    htmx.config.signalr = { ...defaultSignalRConfig }
  })

  afterEach(async function () {
    console.error = originalConsoleError
    await cleanupTest()
    htmx.config.prefix = defaultPrefix
    htmx.config.signalr = { ...defaultSignalRConfig }
    delete window.signalRScriptTest
  })

  describe('review regressions', function () {
    it('does not add send listeners when processing an existing subtree', async function () {
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><button hx-signalr:send="save">Save</button></div>')
      htmx.process(owner)
      htmx.process(owner)
      owner.querySelector('button').click()
      await wait()
      assert.lengthOf(mockHubConnections[0].sentMessages, 1)
    })

    it('replaces send triggers and cancels old delayed callbacks on forced reprocessing', async function () {
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><button hx-signalr:send="save" hx-trigger="click delay:20ms">Save</button></div>')
      const button = owner.querySelector('button')
      button.click()
      button.setAttribute('hx-trigger', 'changed')
      htmx.process(button, true)
      button.click()
      await wait(30)
      assert.lengthOf(mockHubConnections[0].sentMessages, 0)
      button.dispatchEvent(new Event('changed'))
      await wait()
      assert.lengthOf(mockHubConnections[0].sentMessages, 1)
      button.removeAttribute('hx-signalr:send')
      htmx.process(button, true)
      button.dispatchEvent(new Event('changed'))
      await wait()
      assert.lengthOf(mockHubConnections[0].sentMessages, 1)
    })

    it('preserves unrelated listeners when forcibly reprocessing a send trigger', async function () {
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><button hx-signalr:send="save">Save</button></div>')
      const button = owner.querySelector('button')
      let clicks = 0
      button.addEventListener('click', () => { clicks++ })

      button.setAttribute('hx-trigger', 'changed')
      htmx.process(button, true)
      button.click()
      await wait()
      assert.equal(clicks, 1)
      assert.lengthOf(mockHubConnections[0].sentMessages, 0)

      button.dispatchEvent(new Event('changed'))
      await wait()
      assert.lengthOf(mockHubConnections[0].sentMessages, 1)
    })

    it('cancels and reinstalls send triggers during forced reprocessing', async function () {
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><button hx-signalr:send="save" hx-trigger="click delay:20ms">Save</button></div>')
      const button = owner.querySelector('button')

      button.click()
      htmx.process(button, true)
      await wait(30)
      assert.lengthOf(mockHubConnections[0].sentMessages, 0)

      button.click()
      await wait(30)
      assert.lengthOf(mockHubConnections[0].sentMessages, 1)
    })

    it('prevents native form submission before a delayed trigger runs', async function () {
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><form hx-signalr:send="save" hx-trigger="submit delay:20ms"></form></div>')
      const form = owner.querySelector('form')
      let preventedAtTarget
      // Observe cancellation before the playground safety listener can mask a failure.
      form.addEventListener('submit', event => { preventedAtTarget = event.defaultPrevented })
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
      assert.isTrue(preventedAtTarget)
      assert.lengthOf(mockHubConnections[0].sentMessages, 0)
      await wait(30)
      assert.lengthOf(mockHubConnections[0].sentMessages, 1)
    })

    it('installs inline handlers before the initial connection event', function () {
      createProcessedHTML('<div hx-signalr:connect="/hub" hx-on:htmx:signalr:before:connection="event.preventDefault()"></div>')
      assert.lengthOf(mockHubConnections, 0)
    })

    it('preserves checkbox activation for its default change trigger', async function () {
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><input type="checkbox" name="enabled" hx-signalr:send="save"></div>')
      const checkbox = owner.querySelector('input')
      checkbox.click()
      await wait()
      assert.isTrue(checkbox.checked)
      assert.lengthOf(mockHubConnections[0].sentMessages, 1)
      assert.equal(mockHubConnections[0].sentMessages[0].message.enabled, 'on')
    })

    it('restores outgoing capacity after interception is cancelled', async function () {
      htmx.config.signalr.maxOutgoingMessagesQueueSize = 1
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><button hx-signalr:send="save">Save</button></div>')
      const button = owner.querySelector('button')
      button.addEventListener('htmx:signalr:before:message:outgoing', event => event.preventDefault(), { once: true })
      button.click()
      await wait()
      button.click()
      await wait()
      assert.lengthOf(mockHubConnections[0].sentMessages, 1)
    })

    for (const stage of ['interception', 'transport']) {
      it(`restores outgoing capacity after a ${stage} failure`, async function () {
        suppressConsoleError()
        htmx.config.signalr.maxOutgoingMessagesQueueSize = 1
        const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><button hx-signalr:send="save">Save</button></div>')
        const button = owner.querySelector('button')
        const hub = mockHubConnections[0]
        const failure = new Error('Expected failure')
        const errors = []
        owner.addEventListener('htmx:signalr:error', event => errors.push(event.detail.error))
        if (stage === 'interception') {
          button.addEventListener('htmx:signalr:before:message:outgoing', event => {
            event.detail.waitUntil(Promise.reject(failure))
          }, { once: true })
        } else {
          hub.send = () => Promise.reject(failure)
        }
        button.click()
        await wait()
        hub.send = MockHubConnection.prototype.send
        button.click()
        await wait()
        assert.deepEqual(errors, [failure])
        assert.lengthOf(hub.sentMessages, 1)
      })
    }

    it('retains capacity while a failed send waits for reconnect', async function () {
      suppressConsoleError()
      htmx.config.signalr.maxOutgoingMessagesQueueSize = 1
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><button hx-signalr:send="save">Save</button></div>')
      await wait()
      const button = owner.querySelector('button')
      const hub = mockHubConnections[0]
      const errors = []
      owner.addEventListener('htmx:signalr:error', event => errors.push(event.detail.error))
      hub.send = function () {
        this.reconnecting()
        return Promise.reject(new Error('Disconnected during send'))
      }
      button.click()
      await wait()
      button.click()
      await wait()
      assert.deepEqual(errors, ['Outgoing messages queue is full'])
      hub.send = MockHubConnection.prototype.send
      hub.reconnected()
      await wait()
      button.click()
      await wait()
      assert.lengthOf(hub.sentMessages, 2)
      assert.lengthOf(errors, 1)
    })

    it('reserves a single connection during reentrant processing', async function () {
      playground().innerHTML = '<div hx-signalr:connect="/hub"></div>'
      const owner = playground().firstElementChild
      owner.addEventListener('htmx:signalr:before:connection', () => htmx.process(owner), { once: true })
      htmx.process(playground())
      assert.lengthOf(mockHubConnections, 1)
      await htmx.swap({ sourceElement: owner, target: owner, text: '', swap: 'delete' })
      assert.equal(mockHubConnections[0].stopCalls, 1)
    })

    it('does not create a connection for an owner removed by its connection listener', function () {
      playground().innerHTML = '<div hx-signalr:connect="/hub"></div>'
      const owner = playground().firstElementChild
      owner.addEventListener('htmx:signalr:before:connection', () => owner.remove(), { once: true })
      htmx.process(playground())
      assert.lengthOf(mockHubConnections, 0)
    })

    it('keeps the replacement connection when a close listener reprocesses the owner', function () {
      const owner = createProcessedHTML('<div hx-signalr:connect="/one"></div>')
      owner.addEventListener('htmx:signalr:close', () => htmx.process(owner), { once: true })
      owner.setAttribute('hx-signalr:connect', '/two')
      htmx.process(owner, true)
      assert.lengthOf(mockHubConnections, 2)
      assert.equal(mockHubConnections[0].stopCalls, 1)
      assert.equal(mockHubConnections[1].url, '/two')
    })

    it('captures the server method when each send is triggered', async function () {
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><button hx-signalr:send="save">Save</button></div>')
      const button = owner.querySelector('button')
      let release
      const pending = new Promise(resolve => { release = resolve })
      button.addEventListener('htmx:signalr:before:message:outgoing', event => event.detail.waitUntil(pending), { once: true })
      button.click()
      button.click()
      button.setAttribute('hx-signalr:send', 'delete')
      release()
      await wait()
      assert.deepEqual(mockHubConnections[0].sentMessages.map(send => send.method), ['save', 'save'])
    })

    it('removes only its own SignalR method handler', async function () {
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><div hx-signalr:subscribe="echo"></div></div>')
      let received = 0
      mockHubConnections[0].on('echo', () => { received++ })
      const sub = owner.firstElementChild
      await htmx.swap({ sourceElement: sub, target: sub, text: '', swap: 'delete' })
      await mockHubConnections[0].emit('echo', 'External')
      assert.equal(received, 1)
    })

    it('shares case-insensitive subscriptions and preserves the remaining subscriber', async function () {
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><div id="one" hx-signalr:subscribe="Echo,echo"></div><div id="two" hx-signalr:subscribe="echo"></div></div>')
      let messages = 0
      owner.addEventListener('htmx:signalr:before:message:incoming', () => { messages++ })
      const first = owner.querySelector('#one')
      await htmx.swaphubElement.getAttribute({ sourceElement: first, target: first, text: '', swap: 'delete' })
      await mockHubConnections[0].emit('ECHO', 'Still subscribed')
      assert.equal(messages, 1)
      assert.equal(owner.querySelector('#two').textContent, 'Still subscribed')
    })

    it('transfers a moved subscriber to its current connection owner', async function () {
      const page = createProcessedHTML('<main><div id="one" hx-signalr:connect="/one"><div id="sub" hx-signalr:subscribe="echo"></div></div><div id="two" hx-signalr:connect="/two"></div></main>')
      const sub = page.querySelector('#sub')
      page.querySelector('#two').append(sub)
      htmx.process(sub, true)
      await mockHubConnections[1].emit('echo', 'New owner')
      await mockHubConnections[0].emit('echo', 'Old owner')
      assert.equal(sub.textContent, 'New owner')
    })

    it('clears and deletes targets with empty structured content', async function () {
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><div id="sub" hx-signalr:subscribe="echo">Old</div></div>')
      await mockHubConnections[0].emit('echo', { content: '', swap: 'innerHTML swapEmpty:true' })
      assert.equal(owner.querySelector('#sub').innerHTML, '')
      await mockHubConnections[0].emit('echo', { content: '', swap: 'delete' })
      assert.isNull(owner.querySelector('#sub'))
    })

    it('counts asynchronous interception against the outgoing capacity', async function () {
      suppressConsoleError()
      htmx.config.signalr.maxOutgoingMessagesQueueSize = 1
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><button hx-signalr:send="save">Save</button></div>')
      await wait()
      const hub = mockHubConnections[0]
      hub.reconnecting()
      let release
      const pending = new Promise(resolve => { release = resolve })
      const errors = []
      owner.addEventListener('htmx:signalr:before:message:outgoing', event => {
        event.detail.waitUntil(pending)
      })
      owner.addEventListener('htmx:signalr:error', event => { errors.push(event.detail.error) })
      try {
        for (let i = 0; i < 25; i++) owner.querySelector('button').click()
        await wait()
        assert.lengthOf(errors, 24)
        hub.reconnected()
        release()
        await wait()
        assert.lengthOf(hub.sentMessages, 1)
      } finally {
        release()
      }
    })

    it('does not send or swap pending messages after closing during interception', async function () {
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><button hx-signalr:send="save">Save</button><div hx-signalr:subscribe="echo">Old</div></div>')
      let beforeCount = 0
      let started, release
      const interceptionStarted = new Promise(resolve => { started = resolve })
      const pending = new Promise(resolve => { release = resolve })
      for (const direction of ['incoming', 'outgoing']) {
        owner.addEventListener(`htmx:signalr:before:message:${direction}`, event => {
          beforeCount++
          event.detail.waitUntil(pending)
          if (beforeCount === 2) started()
        })
      }
      const hub = mockHubConnections[0]
      hub.emit('echo', 'First')
      hub.emit('echo', 'Second')
      owner.querySelector('button').click()
      owner.querySelector('button').click()
      await interceptionStarted
      hub.close()
      release()
      await wait()
      assert.lengthOf(hub.sentMessages, 0)
      assert.equal(owner.querySelector('[hx-signalr\\:subscribe]').textContent, 'Old')
    })

    it('reuses the controller without waiting for a replaced hub to finish sending', async function () {
      suppressConsoleError()
      htmx.config.signalr.maxOutgoingMessagesQueueSize = 1
      const owner = createProcessedHTML('<div hx-signalr:connect="/one"><button hx-signalr:send="save">Save</button></div>')
      const button = owner.querySelector('button')
      const previous = mockHubConnections[0]
      const controllers = []
      const errors = []
      let started, rejectSend, sent
      const sendStarted = new Promise(resolve => { started = resolve })
      const sendFinished = new Promise(resolve => { sent = resolve })
      previous.send = () => {
        started()
        return new Promise((resolve, reject) => { rejectSend = reject })
      }
      owner.addEventListener('htmx:signalr:before:message:outgoing', event => controllers.push(event.detail.connection))
      owner.addEventListener('htmx:signalr:after:message:outgoing', () => sent())
      owner.addEventListener('htmx:signalr:error', event => errors.push(event.detail.error))

      button.click()
      await sendStarted
      owner.setAttribute('hx-signalr:connect', '/two')
      htmx.process(owner, true)
      button.click()
      await sendFinished
      rejectSend(new Error('Old transport failed after replacement'))
      await wait()

      assert.equal(previous.stopCalls, 1)
      assert.lengthOf(mockHubConnections[1].sentMessages, 1)
      assert.lengthOf(controllers, 2)
      assert.strictEqual(controllers[0], controllers[1])
      assert.isEmpty(errors)
    })

    it('buffers sends while the initial connection is still starting', async function () {
      let start
      htmx.config.signalr.createHubConnection = url => {
        const hub = new MockHubConnection(url)
        hub.start = () => {
          hub.state = 'Connecting'
          return new Promise(resolve => { start = () => { hub.state = 'Connected'; resolve() } })
        }
        mockHubConnections.push(hub)
        return hub
      }
      const owner = createProcessedHTML('<div hx-signalr:connect="/hub"><button hx-signalr:send="save">Save</button></div>')
      owner.querySelector('button').click()
      await wait()
      assert.lengthOf(mockHubConnections[0].sentMessages, 0)
      start()
      await wait()
      assert.lengthOf(mockHubConnections[0].sentMessages, 1)
    })
  })

  describe('connection lifecycle', function () {
    it('uses load as the default connection trigger', async function () {
      const element = createProcessedHTML('<div hx-signalr:connect="/test-hub"></div>')
      await wait()

      assert.lengthOf(mockHubConnections, 1)
      assert.equal(mockHubConnections[0].url, '/test-hub')
      assert.equal(mockHubConnections[0].startCalls, 1)
    })

    it('starts a connection according to hx-trigger', async function () {
      const element = createProcessedHTML('<div hx-signalr:connect="/test-hub" hx-trigger="connect delay:20ms"></div>')

      assert.lengthOf(mockHubConnections, 0)

      element.dispatchEvent(new Event('connect'))
      assert.lengthOf(mockHubConnections, 0)

      await wait(30)
      assert.lengthOf(mockHubConnections, 1)
      const connection = mockHubConnections[0]
      assert.equal(connection.startCalls, 1)

      element.dispatchEvent(new Event('connect'))
      await wait(30)
      assert.equal(connection.startCalls, 1)
    })

    it('configures the default SignalR builder', function () {
      createProcessedHTML('<div hx-signalr:connect="/test-hub"></div>')

      assert.deepEqual(mockBuilders[0].options, {
        url: '/test-hub',
        automaticReconnect: true
      })
    })

    it('configures logging and URL options from htmx.config.signalr', function () {
      const urlOptions = { transport: 'webSockets' }
      htmx.config.signalr.logging = 'Information'
      htmx.config.signalr.urlOptions = urlOptions

      createProcessedHTML('<div hx-signalr:connect="/test-hub"></div>')

      assert.equal(mockBuilders[0].options.logging, 'Information')
      assert.deepEqual(mockBuilders[0].options.urlOptions, urlOptions)
    })

    it('configures automatic reconnect from htmx.config.signalr', function () {
      const retryDelays = [0, 1000, 5000]
      htmx.config.signalr.automaticReconnect = retryDelays

      createProcessedHTML('<div hx-signalr:connect="/test-hub"></div>')

      assert.deepEqual(mockBuilders[0].options.automaticReconnect, retryDelays)
    })

    it('can disable automatic reconnect from htmx.config.signalr', function () {
      htmx.config.signalr.automaticReconnect = false

      createProcessedHTML('<div hx-signalr:connect="/test-hub"></div>')

      assert.notProperty(mockBuilders[0].options, 'automaticReconnect')
    })

    it('allows hx-config to override the global SignalR config', function () {
      htmx.config.signalr.automaticReconnect = false

      createProcessedHTML(`
        <div hx-signalr:connect="/test-hub"
             hx-config='{"signalr":{"automaticReconnect":[0,250]}}'></div>
      `)

      assert.deepEqual(mockBuilders[0].options.automaticReconnect, [0, 250])
    })

    it('supports a custom connection factory in htmx.config.signalr', function () {
      let received
      htmx.config.signalr.createHubConnection = (url, element, config) => {
        received = { url, element, config }
        const connection = new MockHubConnection(url)
        mockHubConnections.push(connection)
        return connection
      }

      const element = createProcessedHTML('<div hx-signalr:connect="/custom-hub"></div>')

      assert.lengthOf(mockBuilders, 0)
      assert.equal(received.url, '/custom-hub')
      assert.strictEqual(received.element, element)
      assert.strictEqual(received.config.createHubConnection, htmx.config.signalr.createHubConnection)
      assert.strictEqual(mockHubConnections[0].url, '/custom-hub')
    })

    it('emits an hx-ws-style before connection event', function () {
      playground().innerHTML = '<div hx-signalr:connect="/test-hub"></div>'
      const element = playground().firstElementChild
      let beforeUrl
      let beforeHub
      let beforeAutomaticReconnect
      let beforeQueueSize
      element.addEventListener('htmx:signalr:before:connection', event => {
        beforeUrl = event.detail.connection.url
        beforeHub = event.detail.connection.hub
        beforeAutomaticReconnect = event.detail.connection.config.automaticReconnect
        beforeQueueSize = event.detail.connection.config.maxOutgoingMessagesQueueSize
      })

      htmx.process(playground())

      assert.equal(beforeUrl, '/test-hub')
      assert.isNull(beforeHub)
      assert.strictEqual(beforeAutomaticReconnect, true)
      assert.strictEqual(beforeQueueSize, 100)
    })

    it('emits an hx-ws-style after connection event', async function () {
      playground().innerHTML = '<div hx-signalr:connect="/test-hub"></div>'
      const element = playground().firstElementChild
      let eventConnection
      let afterDetail
      element.addEventListener('htmx:signalr:before:connection', event => {
        eventConnection = event.detail.connection
      })
      element.addEventListener('htmx:signalr:after:connection', event => { afterDetail = event.detail })

      htmx.process(playground())

      await wait()

      assert.isTrue(afterDetail.connection === eventConnection)
      assert.isTrue(afterDetail.connection.hub === mockHubConnections[0])
    })

    it('allows before connection listeners to cancel creation', function () {
      playground().innerHTML = '<div hx-signalr:connect="/test-hub"></div>'
      const element = playground().firstElementChild
      let closeDetail
      element.addEventListener('htmx:signalr:before:connection', event => {
        event.detail.connection.cancelled = true
      })
      element.addEventListener('htmx:signalr:close', event => { closeDetail = event.detail })

      htmx.process(playground())

      assert.lengthOf(mockHubConnections, 0)
      assert.equal(closeDetail.reason, 'cancelled')
    })

    it('allows before connection listeners to configure connection creation', function () {
      playground().innerHTML = '<div hx-signalr:connect="/test-hub"></div>'
      const element = playground().firstElementChild
      let received
      htmx.config.signalr.createHubConnection = (url, owner, config) => {
        received = { url, owner, config }
        const connection = new MockHubConnection(url)
        mockHubConnections.push(connection)
        return connection
      }
      element.addEventListener('htmx:signalr:before:connection', event => {
        event.detail.connection.url = '/configured-hub'
        event.detail.connection.config.automaticReconnect = false
      })

      htmx.process(playground())

      assert.equal(received.url, '/configured-hub')
      assert.isTrue(received.owner === element)
      assert.isFalse(received.config.automaticReconnect)
    })

    it('creates independent connections for independent owners', function () {
      createProcessedHTML(`
        <main>
          <section hx-signalr:connect="/one"></section>
          <section hx-signalr:connect="/two"></section>
        </main>
      `)

      assert.lengthOf(mockHubConnections, 2)
      assert.deepEqual(mockHubConnections.map(connection => connection.url), ['/one', '/two'])
    })

    it('reuses the connection when the owner is processed again with the same URL', function () {
      const element = createProcessedHTML('<div hx-signalr:connect="/test-hub"></div>')

      htmx.process(element)

      assert.lengthOf(mockHubConnections, 1)
    })

    it('stops the previous connection when the owner is forcibly reprocessed', function () {
      const element = createProcessedHTML('<div hx-signalr:connect="/one"></div>')
      const previousConnection = mockHubConnections[0]

      htmx.process(element, true)

      assert.lengthOf(mockHubConnections, 2)
      assert.equal(previousConnection.stopCalls, 1)
    })

    it('stops the previous connection when the owner URL changes and is forcibly reprocessed', function () {
      const element = createProcessedHTML('<div hx-signalr:connect="/one"></div>')
      const previousConnection = mockHubConnections[0]

      element.setAttribute('hx-signalr:connect', '/two')
      htmx.process(element, true)

      assert.lengthOf(mockHubConnections, 2)
      assert.equal(previousConnection.stopCalls, 1)
    })

    it('emits a reconnecting event with the SignalR error', async function () {
      suppressConsoleError()
      const element = createProcessedHTML('<div hx-signalr:connect="/test-hub"></div>')
      await wait()
      const connection = mockHubConnections[0]
      let detail
      element.addEventListener('htmx:signalr:reconnecting', event => { detail = event.detail })
      const error = new Error('disconnected')

      connection.reconnecting(error)

      assert.strictEqual(detail.connection.hub, connection)
      assert.strictEqual(detail.error, error)
    })

    it('emits a reconnected event with the new SignalR connection ID', async function () {
      const element = createProcessedHTML('<div hx-signalr:connect="/test-hub"></div>')
      await wait()
      const connection = mockHubConnections[0]
      let detail
      element.addEventListener('htmx:signalr:reconnected', event => { detail = event.detail })

      connection.reconnected('new-id')

      assert.strictEqual(detail.connection.hub, connection)
      assert.equal(detail.connectionId, 'new-id')
    })

    it('emits a close event when SignalR closes permanently', async function () {
      suppressConsoleError()
      const element = createProcessedHTML('<div hx-signalr:connect="/test-hub"></div>')
      await wait()
      const connection = mockHubConnections[0]
      let detail
      element.addEventListener('htmx:signalr:close', event => { detail = event.detail })
      const error = new Error('disconnected')

      connection.close(error)

      assert.strictEqual(detail.connection.hub, connection)
      assert.strictEqual(detail.error, error)
      assert.equal(detail.reason, 'closed')
    })

    it('stops the owned connection when htmx removes its element', async function () {
      const element = createProcessedHTML('<div hx-signalr:connect="/test-hub"></div>')
      let closeDetail
      element.addEventListener('htmx:signalr:close', event => { closeDetail = event.detail })

      await htmx.swap({ text: '', target: '[hx-signalr\\:connect]', swap: 'delete', sourceElement: element })

      assert.equal(mockHubConnections[0].stopCalls, 1)
      assert.equal(closeDetail.reason, 'removed')
      assert.isTrue(closeDetail.connection.hub === mockHubConnections[0])
    })
    it('stops the owned connection when htmx removes its parent', async function () {
      const element = createProcessedHTML('<div id="parent"><div hx-signalr:connect="/test-hub"></div></div>')

      await htmx.swap({ text: '', target: '#parent', swap: 'delete', sourceElement: element })

      assert.equal(mockHubConnections[0].stopCalls, 1)
    })

    it('supports the configured htmx attribute prefix', function () {
      htmx.config.prefix = 'data-hx-'

      createProcessedHTML('<div data-hx-signalr:connect="/prefixed"></div>')

      assert.lengthOf(mockHubConnections, 1)
      assert.equal(mockHubConnections[0].url, '/prefixed')
    })

    it('emits an error event when SignalR is unavailable', function () {
      suppressConsoleError()
      const originalSignalR = window.signalR
      playground().innerHTML = '<div hx-signalr:connect="/test-hub"></div>'
      const element = playground().firstElementChild
      let detail
      element.addEventListener('htmx:signalr:error', event => { detail = event.detail })

      try {
        window.signalR = undefined
        assert.doesNotThrow(() => htmx.process(playground()))
      } finally {
        window.signalR = originalSignalR
      }

      assert.lengthOf(mockHubConnections, 0)
      assert.equal(detail.error.message, 'SignalR object not found. Include SignalR script in the page scripts before this extenion.')
    })
  })

  describe('subscriptions and incoming messages', function () {
    it('subscribes to each comma-separated method', function () {
      createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div hx-signalr:subscribe="echo, counter ,notification"></div>
        </div>
      `)

      assert.sameMembers([...mockHubConnections[0].handlers.keys()], ['echo', 'counter', 'notification'])
    })

    it('emits hx-ws-style incoming events and waits for asynchronous work', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo">Original</div>
        </div>
      `)
      let beforeDetail
      let afterDetail
      owner.addEventListener('htmx:signalr:before:message:incoming', event => {
        beforeDetail = event.detail
        event.detail.waitUntil(Promise.resolve().then(() => {
          event.detail.message.data = '<p>Changed asynchronously</p>'
        }))
      })
      owner.addEventListener('htmx:signalr:after:message:incoming', event => { afterDetail = event.detail })

      await mockHubConnections[0].emit('echo', '<p>Original message</p>')

      assert.isTrue(beforeDetail.connection.hub === mockHubConnections[0])
      assert.equal(beforeDetail.message.method, 'echo')
      assert.equal(await beforeDetail.message.text(), '<p>Changed asynchronously</p>')
      assert.equal(owner.querySelector('#subscription').textContent, 'Changed asynchronously')
      assert.isTrue(afterDetail.message === beforeDetail.message)
    })

    it('allows incoming message listeners to cancel processing', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo">Original</div>
        </div>
      `)
      let afterFired = false
      owner.addEventListener('htmx:signalr:before:message:incoming', event => {
        event.detail.cancelled = true
      })
      owner.addEventListener('htmx:signalr:after:message:incoming', () => { afterFired = true })

      await mockHubConnections[0].emit('echo', '<p>Ignored</p>')

      assert.equal(owner.querySelector('#subscription').textContent, 'Original')
      assert.isFalse(afterFired)
    })

    it('serializes incoming message processing', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div hx-signalr:subscribe="echo"></div>
        </div>
      `)
      const order = []
      let releaseFirst
      const firstPending = new Promise(resolve => { releaseFirst = resolve })
      owner.addEventListener('htmx:signalr:before:message:incoming', event => {
        order.push(`before:${event.detail.message.data}`)
        if (event.detail.message.data === 'first') {
          event.detail.waitUntil(firstPending)
        }
      })
      owner.addEventListener('htmx:signalr:after:message:incoming', event => {
        order.push(`after:${event.detail.message.data}`)
      })

      const first = mockHubConnections[0].emit('echo', 'first')
      const second = mockHubConnections[0].emit('echo', 'second')
      await wait()

      assert.deepEqual(order, ['before:first'])

      releaseFirst()
      await Promise.all([first, second])

      assert.deepEqual(order, ['before:first', 'after:first', 'before:second', 'after:second'])
    })

    it('does not process a delayed message after its connection is replaced', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/one">
          <div id="subscription" hx-signalr:subscribe="echo"></div>
        </div>
      `)
      let releaseMessage
      let started
      const interceptionStarted = new Promise(resolve => { started = resolve })
      const messagePending = new Promise(resolve => { releaseMessage = resolve })
      owner.addEventListener('htmx:signalr:before:message:incoming', event => {
        if (event.detail.message.data === '<p>Stale</p>') {
          event.detail.waitUntil(messagePending)
          started()
        }
      })

      const staleMessage = mockHubConnections[0].emit('echo', '<p>Stale</p>')
      await interceptionStarted
      owner.setAttribute('hx-signalr:connect', '/two')
      htmx.process(owner, true)
      await mockHubConnections[1].emit('echo', '<p>Fresh</p>')

      releaseMessage()
      await staleMessage

      assert.equal(owner.querySelector('#subscription').textContent, 'Fresh')
    })

    it('updates every subscriber to the same method once', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="first" hx-signalr:subscribe="echo">First</div>
          <div id="second" hx-signalr:subscribe="echo">Second</div>
        </div>
      `)

      await mockHubConnections[0].emit('echo', '<p>Updated</p>')

      assert.equal(owner.querySelector('#first').textContent, 'Updated')
      assert.equal(owner.querySelector('#second').textContent, 'Updated')
    })

    it('does not duplicate subscriptions when an element is processed again', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo"></div>
        </div>
      `)
      const subscription = owner.querySelector('#subscription')
      let messages = 0
      owner.addEventListener('htmx:signalr:before:message:incoming', () => { messages++ })

      htmx.process(subscription)
      await mockHubConnections[0].emit('echo', 'Updated')

      assert.equal(messages, 1)
    })

    it('swaps string messages into the subscription element by default', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo">Old</div>
        </div>
      `)

      mockHubConnections[0].emit('echo', '<p>New</p>')
      await wait()

      assert.equal(owner.querySelector('#subscription').innerHTML, '<p>New</p>')
    })

    it('swaps raw text messages into the subscription element', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo">Old message</div>
        </div>
      `)

      mockHubConnections[0].emit('echo', 'New message')
      await wait()

      assert.equal(owner.querySelector('#subscription').textContent, 'New message')
    })

    it('handles structured JSON messages using the hx-ws protocol', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div hx-signalr:subscribe="echo">Subscription</div>
          <div id="messages"><p>Existing message</p></div>
        </div>
      `)

      mockHubConnections[0].emit('echo', {
        content: '<main><p class="message">New message</p><p class="ignored">Ignored</p></main>',
        target: '#messages',
        swap: 'beforeend settle:10ms',
        select: '.message'
      })
      await wait(20)

      assert.equal(owner.querySelector('[hx-signalr\\:subscribe]').textContent, 'Subscription')
      assert.equal(owner.querySelectorAll('#messages > p').length, 2)
      assert.equal(owner.querySelector('#messages > .message').textContent, 'New message')
      assert.isNull(owner.querySelector('#messages > .ignored'))
    })

    it('uses hx-target and hx-swap for incoming messages', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div hx-signalr:subscribe="echo" hx-target="#messages" hx-swap="beforeend"></div>
          <div id="messages"><p>First</p></div>
        </div>
      `)

      mockHubConnections[0].emit('echo', '<p>Second</p>')
      await wait()

      assert.include(owner.querySelector('#messages').innerHTML, 'First')
      assert.include(owner.querySelector('#messages').innerHTML, 'Second')
    })

    it('uses hx-select for incoming messages', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div hx-signalr:subscribe="echo" hx-select=".selected"></div>
        </div>
      `)

      mockHubConnections[0].emit('echo', '<main><p class="selected">Keep</p><p>Drop</p></main>')
      await wait()

      assert.equal(owner.querySelector('[hx-signalr\\:subscribe]').innerHTML, '<p class="selected">Keep</p>')
    })

    it('processes hx-partial responses through htmx', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div hx-signalr:subscribe="echo">Subscription</div>
          <div id="widget">Old</div>
        </div>
      `)

      mockHubConnections[0].emit('echo', '<hx-partial hx-target="#widget">Updated</hx-partial>')
      await wait()

      assert.equal(owner.querySelector('#widget').textContent, 'Updated')
      assert.equal(owner.querySelector('[hx-signalr\\:subscribe]').textContent, 'Subscription')
    })

    it('executes scripts in swapped messages', async function () {
      createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div hx-signalr:subscribe="echo"></div>
        </div>
      `)

      mockHubConnections[0].emit('echo', '<script>window.signalRScriptTest = "executed"</script>')
      await wait()

      assert.equal(window.signalRScriptTest, 'executed')
    })

    it('ignores undefined messages', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo">Original</div>
        </div>
      `)

      mockHubConnections[0].emit('echo', undefined)
      await wait()

      assert.equal(owner.querySelector('#subscription').textContent, 'Original')
    })

    it('ignores null messages', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo">Original</div>
        </div>
      `)

      mockHubConnections[0].emit('echo', null)
      await wait()

      assert.equal(owner.querySelector('#subscription').textContent, 'Original')
    })

    it('applies OOB-only updates without clearing the subscription element', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo">Original</div>
          <div id="status">Waiting</div>
        </div>
      `)

      mockHubConnections[0].emit('echo', '<div id="status" hx-swap-oob="true">Connected</div>')
      await wait()

      assert.equal(owner.querySelector('#subscription').textContent, 'Original')
      assert.equal(owner.querySelector('#status').textContent, 'Connected')
    })

    it('honors an explicit swapEmpty:true modifier', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo" hx-swap="innerHTML swapEmpty:true">Original</div>
          <div id="status">Waiting</div>
        </div>
      `)

      mockHubConnections[0].emit('echo', '<div id="status" hx-swap-oob="true">Connected</div>')
      await wait()

      assert.equal(owner.querySelector('#subscription').textContent, '')
      assert.equal(owner.querySelector('#status').textContent, 'Connected')
    })

    it('uses hx-select-oob for client-selected OOB updates', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo" hx-select-oob="#status">Original</div>
          <div id="status">Waiting</div>
        </div>
      `)

      mockHubConnections[0].emit('echo', '<div id="status">Connected</div>')
      await wait()

      assert.equal(owner.querySelector('#subscription').textContent, 'Original')
      assert.equal(owner.querySelector('#status').textContent, 'Connected')
    })

    it('keeps updating remaining subscribers after one is removed', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="first" hx-signalr:subscribe="echo"></div>
          <div id="second" hx-signalr:subscribe="echo">Original</div>
        </div>
      `)
      const first = owner.querySelector('#first')
      const second = owner.querySelector('#second')

      await htmx.swap({ text: '', target: first, swap: 'delete', sourceElement: first })

      await mockHubConnections[0].emit('echo', '<p>Updated</p>')

      assert.equal(owner.querySelector('#second').textContent, 'Updated')
    })

    it('updates method registration when a subscription element is replaced', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo"></div>
        </div>
      `)
      const subscription = owner.querySelector('#subscription')

      await htmx.swap({
        text: '<div id="subscription" hx-signalr:subscribe="counter"></div>',
        target: subscription,
        swap: 'outerHTML',
        sourceElement: subscription
      })

      await mockHubConnections[0].emit('echo', '<p>Ignored</p>')
      assert.equal(owner.querySelector('#subscription').textContent, '')
      await mockHubConnections[0].emit('counter', '<p>Updated</p>')
      assert.equal(owner.querySelector('#subscription').textContent, 'Updated')
    })

    it('unsubscribes immediately when htmx removes a subscription element', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo"></div>
        </div>
      `)
      const subscription = owner.querySelector('#subscription')
      let messages = 0
      owner.addEventListener('htmx:signalr:before:message:incoming', () => { messages++ })

      await htmx.swap({ text: '', target: subscription, swap: 'delete', sourceElement: subscription })
      await mockHubConnections[0].emit('echo', '<p>Ignored</p>')

      assert.equal(messages, 0)
    })

  })

  describe('attribute updates', function () {
    it('uses an updated connection URL after forced reprocessing', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/one">
          <div id="subscription" hx-signalr:subscribe="echo">Original</div>
          <button hx-signalr:send="save">Save</button>
        </div>
      `)
      const previousConnection = mockHubConnections[0]

      owner.setAttribute('hx-signalr:connect', '/two')
      htmx.process(owner, true)
      owner.querySelector('button').click()
      await wait()

      assert.lengthOf(mockHubConnections, 2)
      assert.equal(previousConnection.stopCalls, 1)
      assert.equal(mockHubConnections[1].sentMessages[0].method, 'save')

      mockHubConnections[1].emit('echo', '<p>Updated</p>')
      await wait()

      assert.equal(owner.querySelector('#subscription').textContent, 'Updated')
    })

    it('uses an updated send method on the next trigger', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="draft">Send</button>
        </div>
      `)
      const button = owner.querySelector('button')

      button.setAttribute('hx-signalr:send', 'publish')
      button.click()
      await wait()

      assert.equal(mockHubConnections[0].sentMessages[0].method, 'publish')
    })

    it('replaces subscription methods after forced reprocessing', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo">Original</div>
        </div>
      `)
      const subscription = owner.querySelector('#subscription')

      subscription.setAttribute('hx-signalr:subscribe', 'counter')
      htmx.process(subscription, true)

      await mockHubConnections[0].emit('echo', '<p>Old method</p>')
      assert.equal(subscription.textContent, 'Original')

      await mockHubConnections[0].emit('counter', '<p>New method</p>')
      assert.equal(subscription.textContent, 'New method')
    })

    it('unregisters a removed subscription after forced reprocessing', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div id="subscription" hx-signalr:subscribe="echo">Original</div>
        </div>
      `)
      const subscription = owner.querySelector('#subscription')

      subscription.removeAttribute('hx-signalr:subscribe')
      htmx.process(subscription, true)

      await mockHubConnections[0].emit('echo', '<p>Ignored</p>')

      assert.equal(subscription.textContent, 'Original')
    })

    it('stops a connection whose attribute is removed and forcibly reprocessed', function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <div hx-signalr:subscribe="echo"></div>
        </div>
      `)

      owner.removeAttribute('hx-signalr:connect')
      htmx.process(owner, true)

      assert.equal(mockHubConnections[0].stopCalls, 1)
    })
  })

  describe('outgoing messages', function () {
    it('emits hx-ws-style outgoing events and waits for asynchronous work', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="draft" name="kind" value="note">Send</button>
        </div>
      `)
      const button = owner.querySelector('button')
      let beforeDetail
      let afterDetail
      button.addEventListener('htmx:signalr:before:message:outgoing', event => {
        beforeDetail = event.detail
        event.detail.waitUntil(Promise.resolve().then(() => {
          event.detail.message.method = 'publish'
          event.detail.message.values.extra = 'added asynchronously'
          event.detail.message.headers.Authorization = 'Bearer token'
        }))
      })
      button.addEventListener('htmx:signalr:after:message:outgoing', event => { afterDetail = event.detail })

      button.click()
      await wait()

      const sent = mockHubConnections[0].sentMessages[0]
      assert.isTrue(beforeDetail.connection.hub === mockHubConnections[0])
      assert.equal(sent.method, 'publish')
      assert.equal(sent.message.kind, 'note')
      assert.equal(sent.message.extra, 'added asynchronously')
      assert.equal(sent.message.headers.Authorization, 'Bearer token')
      assert.isTrue(afterDetail.message === beforeDetail.message)
      assert.isTrue(afterDetail.message.data === sent.message)
    })

    it('allows outgoing listeners to replace the SignalR argument', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="save" name="ignored" value="ignored">Send</button>
        </div>
      `)
      owner.querySelector('button').addEventListener('htmx:signalr:before:message:outgoing', event => {
        event.detail.message.data = { custom: true }
      })

      owner.querySelector('button').click()
      await wait()

      assert.deepEqual(mockHubConnections[0].sentMessages[0].message, { custom: true })
    })

    it('allows outgoing message listeners to cancel sending', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="save">Send</button>
        </div>
      `)
      owner.querySelector('button').addEventListener('htmx:signalr:before:message:outgoing', event => {
        event.preventDefault()
      })

      owner.querySelector('button').click()
      await wait()

      assert.lengthOf(mockHubConnections[0].sentMessages, 0)
    })

    it('serializes outgoing message processing and sends', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="save" name="sequence" value="first">Send</button>
        </div>
      `)
      const connection = mockHubConnections[0]
      const button = owner.querySelector('button')
      const order = []
      let releaseFirst
      const firstPending = new Promise(resolve => { releaseFirst = resolve })
      connection.send = function (method, message) {
        this.sentMessages.push({ method, message })
        return message.sequence === 'first' ? firstPending : Promise.resolve()
      }
      button.addEventListener('htmx:signalr:before:message:outgoing', event => {
        order.push(`before:${event.detail.message.values.sequence}`)
      })
      button.addEventListener('htmx:signalr:after:message:outgoing', event => {
        order.push(`after:${event.detail.message.data.sequence}`)
      })

      button.click()
      button.value = 'second'
      button.click()
      await wait()

      assert.deepEqual(connection.sentMessages.map(send => send.message.sequence), ['first'])
      assert.deepEqual(order, ['before:first'])

      releaseFirst()
      await wait()

      assert.deepEqual(connection.sentMessages.map(send => send.message.sequence), ['first', 'second'])
      assert.deepEqual(order, ['before:first', 'after:first', 'before:second', 'after:second'])
    })

    it('serializes a send triggered from an outgoing message listener', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button id="first" hx-signalr:send="first">First</button>
          <button id="second" hx-signalr:send="second">Second</button>
        </div>
      `)
      const firstButton = owner.querySelector('#first')
      const secondButton = owner.querySelector('#second')
      let releaseFirst
      const firstPending = new Promise(resolve => { releaseFirst = resolve })
      firstButton.addEventListener('htmx:signalr:before:message:outgoing', event => {
        secondButton.click()
        event.detail.waitUntil(firstPending)
      }, { once: true })

      firstButton.click()
      await wait()

      assert.lengthOf(mockHubConnections[0].sentMessages, 0)

      releaseFirst()
      await wait()

      assert.deepEqual(mockHubConnections[0].sentMessages.map(send => send.method), ['first', 'second'])
    })

    it('flushes a message queued while an empty flush is completing', async function () {
      playground().innerHTML = `
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="save">Send</button>
        </div>
      `
      const owner = playground().firstElementChild
      const button = owner.querySelector('button')
      owner.addEventListener('htmx:signalr:after:connection', () => {
        queueMicrotask(() => button.click())
      }, { once: true })

      htmx.process(playground())
      await wait()

      assert.lengthOf(mockHubConnections[0].sentMessages, 1)
    })

    it('queues outgoing messages during reconnect and flushes them in order', async function () {
      suppressConsoleError()
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="save" name="sequence" value="first">Send</button>
        </div>
      `)
      await wait()
      const connection = mockHubConnections[0]
      const button = owner.querySelector('button')
      let afterCount = 0
      button.addEventListener('htmx:signalr:after:message:outgoing', () => { afterCount++ })

      connection.reconnecting(new Error('temporary'))
      button.click()
      button.value = 'second'
      button.click()
      await wait()

      assert.lengthOf(connection.sentMessages, 0)
      assert.equal(afterCount, 0)

      connection.reconnected('new-id')
      await wait()

      assert.deepEqual(connection.sentMessages.map(send => send.message.sequence), ['first', 'second'])
      assert.equal(afterCount, 2)
    })

    it('reports an error when the reconnect queue is full', async function () {
      suppressConsoleError()
      htmx.config.signalr.maxOutgoingMessagesQueueSize = 1
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="save" name="sequence" value="first">Send</button>
        </div>
      `)
      await wait()
      const connection = mockHubConnections[0]
      const button = owner.querySelector('button')
      const errors = []
      button.addEventListener('htmx:signalr:error', event => { errors.push(event.detail.error) })

      connection.reconnecting(new Error('temporary'))
      button.click()
      button.value = 'second'
      button.click()
      await wait()

      assert.deepEqual(errors, ['Outgoing messages queue is full'])

      connection.reconnected('new-id')
      await wait()

      assert.deepEqual(connection.sentMessages.map(send => send.message.sequence), ['first'])
    })

    it('discards queued messages when the connection closes', async function () {
      suppressConsoleError()
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="save">Send</button>
        </div>
      `)
      await wait()
      const connection = mockHubConnections[0]
      const button = owner.querySelector('button')
      connection.reconnecting(new Error('temporary'))
      button.click()
      await wait()
      assert.lengthOf(connection.sentMessages, 0)

      connection.close()

      connection.reconnected('ignored')
      await wait()
      assert.lengthOf(connection.sentMessages, 0)
    })

    it('sends form values and htmx headers on submit', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <form id="sender" hx-signalr:send="echo">
            <input name="message" value="Hello">
            <button type="submit">Send</button>
          </form>
        </div>
      `)
      const form = owner.querySelector('form')

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await wait()

      assert.lengthOf(mockHubConnections[0].sentMessages, 1)
      assert.equal(mockHubConnections[0].sentMessages[0].method, 'echo')
      assert.equal(mockHubConnections[0].sentMessages[0].message.message, 'Hello')
      assert.equal(mockHubConnections[0].sentMessages[0].message.headers['HX-Source'], 'form#sender')
      assert.equal(mockHubConnections[0].sentMessages[0].message.headers['HX-Current-URL'], location.href)
    })

    it('coalesces repeated form fields into an array', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <form hx-signalr:send="save">
            <input name="tag" value="one">
            <input name="tag" value="two">
          </form>
        </div>
      `)

      owner.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await wait()

      assert.deepEqual(mockHubConnections[0].sentMessages[0].message.tag, ['one', 'two'])
    })

    it('uses click as the default trigger for buttons', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="save" name="action" value="publish">Publish</button>
        </div>
      `)
      const button = owner.querySelector('button')

      button.dispatchEvent(new Event('change', { bubbles: true }))
      await wait()
      assert.lengthOf(mockHubConnections[0].sentMessages, 0)

      button.click()
      await wait()
      assert.equal(mockHubConnections[0].sentMessages[0].method, 'save')
      assert.equal(mockHubConnections[0].sentMessages[0].message.action, 'publish')
    })

    it('uses change as the default trigger for inputs', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <form><input hx-signalr:send="update" name="status" value="ready"></form>
        </div>
      `)
      const input = owner.querySelector('input')

      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
      await wait()

      assert.equal(mockHubConnections[0].sentMessages[0].method, 'update')
      assert.equal(mockHubConnections[0].sentMessages[0].message.status, 'ready')
    })

    it('respects a custom hx-trigger', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="refresh" hx-trigger="refresh">Refresh</button>
        </div>
      `)
      const button = owner.querySelector('button')

      button.click()
      await wait()
      assert.lengthOf(mockHubConnections[0].sentMessages, 0)

      button.dispatchEvent(new Event('refresh', { bubbles: true, cancelable: true }))
      await wait()
      assert.equal(mockHubConnections[0].sentMessages[0].method, 'refresh')
    })

    it('respects delay and once trigger modifiers', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="save" hx-trigger="click delay:20ms once">Save</button>
        </div>
      `)
      const button = owner.querySelector('button')

      button.click()
      assert.lengthOf(mockHubConnections[0].sentMessages, 0)
      await wait(60)
      assert.lengthOf(mockHubConnections[0].sentMessages, 1)

      button.click()
      await wait(30)
      assert.lengthOf(mockHubConnections[0].sentMessages, 1)
    })

    it('includes hx-vals in the outgoing message', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="save" hx-vals='{"count":42,"active":true}'>Save</button>
        </div>
      `)

      owner.querySelector('button').click()
      await wait()

      const message = mockHubConnections[0].sentMessages[0].message
      assert.strictEqual(message.count, 42)
      assert.strictEqual(message.active, true)
    })

    it('includes values selected with hx-include', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <input id="included" name="extra" value="included">
          <button hx-signalr:send="save" hx-include="#included">Save</button>
        </div>
      `)

      owner.querySelector('button').click()
      await wait()

      assert.equal(mockHubConnections[0].sentMessages[0].message.extra, 'included')
    })

    it('includes HX-Target when hx-target is set', async function () {
      const owner = createProcessedHTML(`
        <div hx-signalr:connect="/test-hub">
          <button hx-signalr:send="save" hx-target="#result">Save</button>
          <div id="result"></div>
        </div>
      `)

      owner.querySelector('button').click()
      await wait()

      assert.equal(mockHubConnections[0].sentMessages[0].message.headers['HX-Target'], 'div#result')
    })

    it('uses the nearest ancestor SignalR connection', async function () {
      const page = createProcessedHTML(`
        <main hx-signalr:connect="/outer">
          <section hx-signalr:connect="/inner">
            <button hx-signalr:send="save">Save</button>
          </section>
        </main>
      `)

      page.querySelector('button').click()
      await wait()

      assert.lengthOf(mockHubConnections[0].sentMessages, 0)
      assert.lengthOf(mockHubConnections[1].sentMessages, 1)
    })

    it('keeps sends isolated between separate connection owners', async function () {
      const page = createProcessedHTML(`
        <main>
          <section hx-signalr:connect="/one"><button hx-signalr:send="first">One</button></section>
          <section hx-signalr:connect="/two"><button hx-signalr:send="second">Two</button></section>
        </main>
      `)

      const buttons = page.querySelectorAll('button')
      buttons[0].click()
      buttons[1].click()
      await wait()

      assert.deepEqual(mockHubConnections[0].sentMessages.map(send => send.method), ['first'])
      assert.deepEqual(mockHubConnections[1].sentMessages.map(send => send.method), ['second'])
    })

    it('reports a send element with no SignalR connection context', async function () {
      suppressConsoleError()
      playground().innerHTML = '<button hx-signalr:send="save">Save</button>'
      const button = playground().firstElementChild
      let error
      button.addEventListener('htmx:signalr:error', event => {
        error = event.detail.error
        event.preventDefault()
      })

      htmx.process(playground())
      button.click()
      await wait()

      assert.lengthOf(mockHubConnections, 0)
      assert.equal(error, 'No SignalR connection found for element')
    })
  })
})
