# htmx-signalr

> [!TIP]
> If you are using htmx 2.0, switch to `htmx-2.0` branch for updated version. Once htmx 2.0 is released, the branch
> it will be merged to master, while htmx 1.0 compatible implementation will always be available in corresponding branch.

> [!WARNING]
> htmx 1.0 implementation of the extension relies on features available in htmx>=v1.8.0 and WILL BREAK on older versions.

The SignalR extension allows to connect and interact with SignalR server directly from html.
It establishes connection to the hub, subscribes to the events, allows to send messages to the server,
processes incoming messages and swaps the content into your htmx page. In a way, it combines features from SSE
and WebSockets extensions, allowing for bi-directional browser-server communication and supporting
"channels" ("methods" in SignalR terminology) to distinguish messages between each other.

[SignalR](https://docs.microsoft.com/en-us/aspnet/core/signalr/introduction?view=aspnetcore-6.0) is an open-source
library that simplifies adding real-time web functionality to apps. Real-time web functionality enables server-side code
to push content to clients instantly.

## How to use

Install the extension by including the script into your page, as well as SignalR library itself.

```html

<script src="https://unpkg.com/@microsoft/signalr@next/dist/browser/signalr.js"></script>
<script src="/js/hx-signalr.js"></script>
```

Activate the extension by adding `hx-ext` attribute to your page

```html

<div hx-ext="signalr">...</div>
```

The extension provides three attributes to create and interact with the connection.

### `signalr-connect`

`signalr-connect` attribute is used to establish connection to SignalR hub. Pass hub URL as a value attribute in any
format, supported by SignalR.

```html

<div signalr-connect="/hub"></div>
```

Other attributes will use the connection from the first parent in page structure.

### `signalr-send`

`signalr-send` attribute is used to send messages via SignalR connection. The data is serialized in an object, where
fields are mapped from input elements
and values from `hx-include`, `hx-vals`, etc. Additionally, [request headers](https://htmx.org/docs/#request-headers)
are attached in `HEADERS` property.

```html

<form signalr-send="echo">
    <input type="text" name="message">
    <button type="submit">Submit</button>
</form>
```

The form above will be sent as

```json
{
  "message": "<value>",
  "HEADERS": {
    ...
  }
}
```

That message can be handled by the following hub method

```csharp
public async Task Echo(EchoRequest request)
{
  await Clients.Caller.SendAsync("echo", $@"<div id=""echo"">{request.message}</div><div hx-swap-oob=""true"" id=""echo-oob-data"">{new Random().Next()}</div>");
}

public record EchoRequest(string message);
```

:exclamation::exclamation: Please note, that your request object **MUST** define its fields as strings. The reason for this is the fact that HTML inputs
have no distinction between numbers and strings values, but JSON has. Doing client-side conversion will inevitably cause many
edge-cases and bugs. Server-side validation and mapping is much easier, although it does introduce a bit of a boilerplate.

### `signalr-subscribe`

`signalr-subscribe` attribute is used to declare client method and attach message handler to it. Received messages will
be swapped into the page body.
The default target is `innerHTML` of the element with that attribute. The target and swapping method can be changed
with `hx-target` and `hx-swap` attributes. If the message
contains OOB elements, they will also be processed as usual.

```html
<!-- Standard subscription -->
<div signalr-subscribe="counter">
</div>

<!-- Changing target and swapping method -->
<div signalr-subscribe="echo" hx-target="#echo-target" hx-swap="beforeend">
</div>
<div id="echo-target"></div>
<!-- OOB swapping is supported -->
<div id="echo-oob-data"></div>
```

When the message is received, it is processed with similar pipeline as standard htmx responses. That means that
extensions that transform response content are supported, and you can, for example, use client side templates to render
JSON data on the page.

An element can be subscribed to multiple methods by passing their names as comma separated list. But be careful - the
extension has no native way to specify different swap methods or targets for different methods, so messages for
different methods can fight over the same target. Best way to use multiple subscriptions is to listen for the
events with JS or _hyperscript and handle each method programmatically.

### Events

#### `htmx:signalr:start`

This event is triggered once connection with the hub has been established. This event is raised on `signalr-connect` element.

- `connectionId` contains id of SignalR connection object (if present)

Cancelling the event has no effect.

#### `htmx:signalr:message`

This event is triggered on the elements with active method subscription when a message is received from the hub
connection. `detail` property of the event has a few fields:

- `message` contains message object as received by the handler. Can be modified by event handler, which will affect
  next processing steps.
- `method` contains the name of the method, that received the message. Can be used to filter events when using multiple
  method subscriptions. Modifying this field has no effect.
- `target` contains target element. Can be changed to redirect swapping to a different target element. Does not affect
  OOB swaps.

Cancelling the event will prevent any further processing.

#### `htmx:signalr:beforeSend`

This event is triggered just before sending a message. `detail` property contains the parameters of the message being sent, which can be modified by the event handler:

- `method` contains the name of the method being called. Modifying this field will retarget the message to a different handler.
- `headers` contains the headers, that will be attached into `HEADERS` field.
- `allParameters` contains all parameters from the form inputs and `hx-vals` attributes.
- `filteredParameters` contains all parameters after filtering is applied. The value from this field will be sent as-is.

Cancelling the event will prevent sending.

#### `htmx:signalr:afterSend`

This event is triggered just after message was sent. Modifying the data in `details` property has no effect.

- `method` contains the name of the method that was called.
- `message` contains the data that was sent to the hub.

Cancelling this event has no effect.

#### `htmx:signalr:reconnecting`, `htmx:signalr:close`

These events are matching with corresponding SignalR events
[`onreconnecting`](https://learn.microsoft.com/en-us/javascript/api/%40microsoft/signalr/hubconnection?view=signalr-js-latest#@microsoft-signalr-hubconnection-onreconnecting),
and [`onclose`](https://learn.microsoft.com/en-us/javascript/api/%40microsoft/signalr/hubconnection?view=signalr-js-latest#@microsoft-signalr-hubconnection-onclose).

- `error` contains original SignalR error object (if present)

#### `htmx:signalr:reconnected`

These events are matching with corresponding SignalR event
[`onreconnected`](https://learn.microsoft.com/en-us/javascript/api/%40microsoft/signalr/hubconnection?view=signalr-js-latest#@microsoft-signalr-hubconnection-onreconnected)

- `connectionId` contains id of SignalR connection object (if present)

You can use those events to display connection status in the UI and/or gracefully handle connection loss.
Here is basic example of showing reconnection status using [`hx-on`](https://htmx.org/attributes/hx-on/) attribute

```html
<div id="signalr-indicator" style="display: none;">Connecting to the hub...</div>
<div hx-ext="signalr" signalr-connect="/hub"
     hx-on:htmx:signalr:reconnecting="htmx.find('#signalr-indicator').style.display='block'"
     hx-on:htmx:signalr:reconnected="htmx.find('#signalr-indicator').style.display='none'"></div>
```

### `htmx.createHubConnection`

Similar to WebSocket extension, it is possible to provide custom factory method for hub connection. This way you can
control all aspects of the connection yourself.

```js
htmx.createHubConnection = function (url) {
  return new signalR.HubConnectionBuilder()
    .withUrl(url)
    .withAutomaticReconnect(Array(100).fill(5000))   // attempt up to 100 reconnections every 5 seconds
    .build()
}
```

## License

This library is licensed under the terms of [MIT License](LICENSE)

The implementation is based on the official [SSE](https://github.com/bigskysoftware/htmx/blob/master/src/ext/sse.js)
and [WebSockets](https://github.com/bigskysoftware/htmx/blob/master/src/ext/ws.js)
extensions from [htmx](https://github.com/bigskysoftware/htmx) by Big Sky Software, which are licensed under the terms
of [BSD Zero-Clause License](https://github.com/bigskysoftware/htmx/blob/master/LICENSE).
