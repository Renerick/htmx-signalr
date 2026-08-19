# hx-signalr

> [!TIP]
> For htmx 2, use the `htmx-2` branch. For the legacy htmx 1 implementation, use the `htmx-1.0` branch.

The htmx SignalR extension provides integration with SignalR servers for htmx-powered pages, allowing bidirectional
real-time client-server communication. It's an ASP.NET Core-native alternative to htmx's WebSockets and SSE extensions.

SignalR is an open-source library that simplifies adding real-time web functionality to apps.
Real-time web functionality enables server-side code to push content to clients instantly.

This version of the extension is made for htmx 4.

## Quick start

On the client, install htmx, SignalR, and the extension script, and use the provided attributes:

```html
<script src="https://cdn.jsdelivr.net/npm/htmx.org@4.0.0/dist/htmx.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@microsoft/signalr@10.0.11/dist/browser/signalr.min.js"></script>
<script src="/js/hx-signalr.js"></script>

<section hx-signalr:connect="/chat">
  <form hx-signalr:send="SendMessage">
    <input name="message" required>
    <button type="submit">Send</button>
  </form>

  <div hx-signalr:subscribe="ReceiveMessage"
       hx-swap="beforeend"></div>
</section>
```

On the ASP.NET Core server, create and register a SignalR hub:

```csharp
public sealed record ChatRequest(string Message);

public sealed class ChatHub : Hub
{
    public async Task SendMessage(ChatRequest request)
    {
        var html = $"<p>{HtmlEncoder.Default.Encode(request.Message)}</p>";
        await Clients.All.SendAsync("ReceiveMessage", html);
    }
}

builder.Services.AddSignalR();
app.MapHub<ChatHub>("/chat");
```

## How to use

Download the extension script from the `dist/` directory or build it from the TypeScript source yourself.
You also need the htmx and SignalR scripts included in the page. Both should be included
before the extension script:

```html
<script src="/js/htmx.min.js"></script>
<script src="/js/signalr.min.js"></script>
<script src="/js/hx-signalr.js"></script>
```

If you use the htmx 4 extension whitelist, add it there:

```html
<meta name="htmx-config" content="extensions:hx-signalr">
```

### `hx-signalr:connect`

This attribute marks an element as a HubConnection owner. It will create a hub connection via the specified URL.

```html
<main hx-signalr:connect="/notifications">
  <!-- This subscriber and sender use /notifications. -->
  <output hx-signalr:subscribe="UnreadCount"></output>
  <button hx-signalr:send="MarkAllRead">Mark all read</button>

  <section hx-signalr:connect="/presence">
    <!-- This subscriber uses /presence. -->
    <output hx-signalr:subscribe="OnlineUsers"></output>
  </section>
</main>
```

To delay the connection until a certain event, you can specify `hx-trigger` on the same element.

```html
<section id="chat"
         hx-signalr:connect="/chat"
         hx-trigger="open-chat once">
</section>

<button onclick="htmx.trigger('#chat', 'open-chat')">Open chat</button>
```

Other attributes will find a connection to use by looking for a parent with an `hx-signalr:connect` attribute.

### `hx-signalr:subscribe`

This attribute subscribes the element to one or more client hub methods. Content from the incoming messages
will be swapped the same way as usual htmx responses. All swap-related attributes
(`hx-target`, `hx-swap`, `hx-select[-oob]`) are supported.

```html
<section hx-signalr:connect="/dashboard">
  <div hx-signalr:subscribe="StatusChanged"></div>

  <ol id="activity"></ol>
  <div hx-signalr:subscribe="AuditCreated, AuditUpdated"
       hx-target="#activity"
       hx-swap="beforeend"></div>
</section>
```

The method subscription expects a single method argument, which can be either a string or an object.

String arguments are treated like raw HTML content and swapped as is:

```csharp
await Clients.All.SendAsync("StatusChanged", "<strong>Online</strong>");
```

Objects are expected to follow the following structure (which is *suspiciously* the same as the message
format of the `hx-ws` extension):

```json
{
  "content": "<li class=\"activity\">Deployment completed</li>",
  "target": "#activity",
  "swap": "beforeend settle:10ms",
  "select": ".activity"
}
```

| Property  | Purpose                           |
| --------- | --------------------------------- |
| `content` | HTML content that will be swapped |
| `target`  | Server-side `hx-target` override  |
| `swap`    | Server-side `hx-swap` override    |
| `select`  | Server-side `hx-select` override  |

You can send them from the server like so:

```csharp
await Clients.Caller.SendAsync("AuditCreated", new
{
    content = "<li class=\"activity\">Created</li>",
    target = "#activity",
    swap = "beforeend",
    select = ".activity"
});
```

### `hx-signalr:send`

This attribute is used to send messages to the specified server method.

```html
<section hx-signalr:connect="/orders">
  <form hx-signalr:send="CreateOrder">
    <input name="productId" value="42">
    <input name="quantity" type="number" value="2">
    <button type="submit" name="action" value="buy">Buy</button>
  </form>
</section>
```
Request data will be serialized as a JSON object, where each form field is mapped into a corresponding property.
Additionally, [htmx request headers](https://four.htmx.org/docs/#request-headers) are attached as a `headers`
property:

```json
{
  "productId": "42",
  "quantity": "2",
  "action": "buy",
  "headers": {
    "HX-Request": "true",
    "HX-Source": "form",
    "HX-Current-URL": "https://example.com/orders"
  }
}
```

`hx-vals` and `hx-include` attributes are supported as well.

Message sending from elements is serialized on the connection instance, so that messages will always be sent
in the order in which sends were triggered, even if event handlers or `hx-vals` processing require async operations.

```html
<button hx-signalr:send="SaveDraft"
        hx-include="#title"
        hx-vals='js:{ revision: 3, token: await getToken() }'>
  Save
</button>
```

The message is sent on the specified `hx-trigger`. In case the attribute is not present, the following default
events will be used instead:

| Element                                          | Default trigger |
| ------------------------------------------------ | --------------- |
| `<form>`                                         | `submit`        |
| Text-like `<input>`, `<select>`, or `<textarea>` | `change`        |
| Any other element                                | `click`         |

```html
<button hx-signalr:send="Refresh"
        hx-trigger="click once delay:250ms">
  Refresh
</button>
```

### Updating attributes at runtime

Previous versions of the extension tried their best to keep track of element attributes so that explicit
reinitialization was not required. This version steps away from this approach. If you want to use
custom JS to update `hx-signalr:*` attributes, you will need to call `htmx.process(element, true)` after
the change, where `true` means full element reinitialization.

The exception is `hx-signalr:send`, which will always use the actual attribute value. You still need to reinitialize
the element if `hx-trigger` has changed.

```js
const subscription = document.querySelector('#live-feed')
subscription.setAttribute('hx-signalr:subscribe', 'ArchivedItem')
htmx.process(subscription, true)
```

## Configuration

Extension configuration is available through the global `htmx.config.signalr` object. It allows you to set SignalR
HubConnection settings.

```js
htmx.config.signalr = {
  logging: signalR.LogLevel.Information,
  urlOptions: {
    accessTokenFactory: () => sessionStorage.getItem('access-token')
  },
  automaticReconnect: [0, 2_000, 10_000, 30_000],
  keepAliveInterval: 15_000,
  serverTimeout: 30_000,
  statefulReconnect: { bufferSize: 100_000 },
  maxOutgoingMessagesQueueSize: 100
}
```

Global configuration can be set with `<meta name="htmx-config">`. Element configuration via `hx-config` is also
supported:

```html
<section hx-signalr:connect="/chat"
         hx-config='{"signalr":{"automaticReconnect":[0,1000,5000],"serverTimeout":60000}}'>
</section>
```

Refer to the SignalR [HubConnectionBuilder docs](https://learn.microsoft.com/en-us/javascript/api/@microsoft/signalr/hubconnectionbuilder?view=signalr-js-latest#methods) for detailed descriptions of its settings.

`maxOutgoingMessagesQueueSize` sets the upper bound of the internal message queue, which is used to queue messages
during hub reconnection.

`createHubConnection` allows you to set a custom factory method for the HubConnection, giving you full
control over its creation.

```js
htmx.config.signalr.createHubConnection = (url, owner, config) => {
  console.debug('Creating a connection for', owner)

  return new signalR.HubConnectionBuilder()
    .withUrl(url, config.urlOptions)
    .withAutomaticReconnect()
    .build()
}
```

## Event reference

The hx-signalr extension emits events for the hub connection lifecycle and incoming and outgoing message processing.
They can be used to update page state based on connection and message status, customize connection configuration,
or modify message content.

Some events emit a `detail.cancelled` field. Setting it to `true` or calling `.preventDefault()`
will halt the process that emitted the event.

Some events expose a `waitUntil(work: Promise<unknown>)` method. It can be used to queue asynchronous work that
will be awaited if event processing requires asynchronous operations.

After the hub is connected, most events will expose a `connection` object. It's a wrapper around the raw
`HubConnection` instance that handles message queueing, serialization, and safer event subscription. Please note
that while it's just a JS object with public properties, modifying them may have no effect or may break the connection.
Properties and methods that are not described below are implementation details and can be changed at any time.

- `url: string` - hub URL
- `config: HtmxSignalRConfig` - hub configuration
- `subscribe(method: string, handleMessage: (m: any) => Promise<unknown>): void` - add method handler
- `unsubscribe(m: string, handleMessage: (m: any) => Promise<unknown>): void` - remove method handler
- `sendFromElement(elt: Element, messageProvider: Promise<OutgoingMessage>): Promise<void>` - sends a message
  as if it was sent from an `hx-signalr:send` element, with all corresponding events emitted from said element.
  `messageProvider` is the async provider of the message. For a description of `OutgoingMessage`, refer to the
  `htmx:signalr:before:message:outgoing` event, `detail.message` field
- `send(method: string, message: Record<string, unknown>, callback: () => {}): Promise<void>` - sends `message`
  to the specified `method`. If the hub is reconnecting, sending will be queued internally until the
  connection is reestablished. `callback` will be invoked after the message has been sent.
- `stop(reason: string): void` stops the connection, halting all further operations

### Connection events

These events are emitted from the `hx-signalr:connect` element.

#### `htmx:signalr:before:connection`

This event is emitted when a hub connection is about to be established.

- `detail.url` - hub URL. Can be modified
- `detail.config` - configuration that will be used by the hub. Can be modified
- `detail.cancelled` - cancellation flag

```js
document.addEventListener('htmx:signalr:before:connection', event => {
  if (!currentUser.mayConnect) {
    event.preventDefault()
    return
  }

  event.detail.config.logging = signalR.LogLevel.Warning
})
```

#### `htmx:signalr:after:connection`

This event is emitted after the hub connection is fully established.

- `detail.connection` - connection instance

```js
document.addEventListener('htmx:signalr:after:connection', event => {
  console.log('Connected to', event.detail.connection.url)
})
```

#### `htmx:signalr:reconnecting`

This event is emitted when the hub connection starts trying to reconnect.

- `detail.connection` - connection instance
- `detail.error` - error that caused reconnection

```js
document.addEventListener('htmx:signalr:reconnecting', event => {
  document.querySelector('#connection-state').textContent = 'Reconnecting…'
  console.warn(event.detail.error)
})
```

#### `htmx:signalr:reconnected`

This event is emitted when the hub connection has reconnected successfully.

- `detail.connection` - connection instance

```js
document.addEventListener('htmx:signalr:reconnected', event => {
  document.querySelector('#connection-state').textContent = 'Connected'
  console.log('Reconnected to', event.detail.connection.url)
})
```

#### `htmx:signalr:close`

This event is emitted when the hub connection has been fully closed.

- `detail.connection` - connection instance
- `detail.error` - error that caused closure
- `detail.reason` - closure reason as text

`reason` has the following built-in values:

- `removed` when the connection element is cleaned up by htmx
- `cancelled` when `htmx:signalr:before:connection` event is cancelled
- `closed` when the connection is closed otherwise

You can pass your own value to the connection instance's `stop(reason)` method.

```js
document.addEventListener('htmx:signalr:close', event => {
  console.log(`Connection ${event.detail.reason}`, event.detail.error)
})
```

### `htmx:signalr:error`

This event is emitted when an unexpected error occurs.

- `detail.error` - the error object

```js
document.addEventListener('htmx:signalr:error', event => {
  console.error('SignalR extension error:', event.detail.error)
})
```

### Subscription events

These events are emitted from `hx-signalr:subscribe` elements.

#### `htmx:signalr:before:message:incoming`

This event is emitted when a message has been received and before any processing.

- `detail.connection` - connection instance
- `detail.cancelled` - cancellation flag
- `detail.message.method` - method that received the message
- `detail.message.data` - raw content of the message. Can be modified
- `detail.waitUntil()` - queues async work to wait for before further processing

```js
document.addEventListener('htmx:signalr:before:message:incoming', event => {
  if (event.detail.message.method === 'AdminNotice' && !currentUser.isAdmin) {
    event.preventDefault()
    return
  }

  event.detail.waitUntil(loadDisplayPreferences().then(preferences => {
    event.detail.message.data = decorateMessage(
      event.detail.message.data,
      preferences
    )
  }))
})
```

#### `htmx:signalr:after:message:incoming`

This event is emitted when a message has been received and after processing is fully completed.

- `detail.connection` - connection instance
- `detail.message.method` - method that received the message
- `detail.message.data` - raw content of the message

```js
document.addEventListener('htmx:signalr:after:message:incoming', event => {
  console.log('Swapped message from', event.detail.message.method)
})
```

### Sending events

These events are emitted from `hx-signalr:send` elements.

#### `htmx:signalr:before:message:outgoing`

This event is emitted when message sending has been triggered, after all the needed information for the message
has been collected, and before the message is sent.

- `detail.connection` - connection instance
- `detail.cancelled` - cancellation flag
- `detail.message.method` - destination method for the message. Can be modified
- `detail.message.values` - form values that will be sent. Can be modified
- `detail.message.headers` - htmx headers that will be sent. Can be modified
- `detail.message.data` - raw content of the message. Can be modified.

  Initially, it's `undefined`, and later it will be filled by combining `values` and `headers`.
  If an event handler sets a value, that value will be sent as is instead.

- `detail.waitUntil()` - queues async work to wait for before further processing

```js
document.addEventListener('htmx:signalr:before:message:outgoing', event => {
  event.detail.waitUntil(getAccessToken().then(token => {
    event.detail.message.headers.Authorization = `Bearer ${token}`
  }))

  if (event.detail.message.method === 'DeleteAccount') {
    event.detail.message.data = {
      confirmation: 'DELETE',
      headers: event.detail.message.headers
    }
  }
})
```

#### `htmx:signalr:after:message:outgoing`

This event is emitted when a message has been sent.

- `detail.connection` - connection instance
- `detail.message.method` - destination method for the message
- `detail.message.values` - form values that were sent
- `detail.message.headers` - htmx headers that were sent
- `detail.message.data` - raw content of the sent message

```js
document.addEventListener('htmx:signalr:after:message:outgoing', event => {
  console.log('Sent', event.detail.message.method)
})
```

## License

This project is licensed under the [MIT License](LICENSE).

The implementation is based on the official WebSocket extension, licensed under the
[BSD Zero-Clause License](https://github.com/bigskysoftware/htmx/blob/master/LICENSE).
