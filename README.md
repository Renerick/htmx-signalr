# htmx-signal

The SignalR extension allows to connect and interact with SignalR server directly from html.
It establishes connection to the hub, subscribes to the events, allows to send messages to the server,
processes incoming messages and swaps the content into your htmx page.  In a way, it combines features from SSE
and WebSockets extensions, allowing for bi-directional browser-server communication and supporting
"channels" ("methods" in SignalR terminology) to distinguish messages between each other.

[SignalR](https://docs.microsoft.com/en-us/aspnet/core/signalr/introduction?view=aspnetcore-6.0) is an open-source library that
simplifies adding real-time web functionality to apps. Real-time web functionality enables server-side code to push content to clients instantly.

## How to use

Install the extension by including the script into your page, as well as SignalR library itself.

```html
<script src="https://unpkg.com/@microsoft/signalr@next/dist/browser/signalr.js"></script>
<script src="/js/hx-signal.js"></script>
```

Activate the extension by adding `hx-ext` attribute to your page

```html
<div hx-ext="signalr">...</div>
```

The extension provides three attributes, which are similar to [SSE extension](https://htmx.org/extensions/server-sent-events/)

### `signalr-connect`

`signalr-connect` attribute is used to establish connection to SignalR hub. Pass hub URL as a value attribute in any format, supported by SignalR.

```html
<div signalr-connect="/hub"></div>
```

Other attributes will use the connection from the first parent in page structure.

### `signal-send`

`signalr-send` attribute is used to send messages via SignalR connection. The data is serialized in an object, where fields are mapped from input elements
and values from `hx-include`, `hx-vals`, etc. Additionally, [request headers](https://htmx.org/docs/#request-headers) are attached in `HEADERS` property.

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
public record EchoRequest(string message);

public async Task Echo(EchoRequest request)
{
  await Clients.Caller.SendAsync("echo", $@"<div id=""echo"">{request.message}</div><div hx-swap-oob=""true"" id=""echo-oob-data"">{new Random().Next()}</div>");
}
```

### `signalr-subscribe`

`signalr-subscribe` attribute is used to declare client method and attach message handler to it. Received messages will be swapped into the page body.
The default target is `innerHTML` of the element with that attribute. The target and swapping method can be changed with `hx-target` and `hx-swap` attributes. If the message
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

When the message is received, it is processed with similar pipeline as standard htmx responses. That means, that extensions that transform response content
are supported, and you can, for example, use client side templates to render JSON data on the page.

## License

This library is licensed under the terms of [MIT License](LICENSE)

The implementation is based on the official [SSE](https://github.com/bigskysoftware/htmx/blob/master/src/ext/sse.js) and [WebSockets](https://github.com/bigskysoftware/htmx/blob/master/src/ext/ws.js)
extensions from [htmx](https://github.com/bigskysoftware/htmx) by Big Sky Software, which are licensed under the terms of [BSD 2-Clause "Simplified" License](https://github.com/bigskysoftware/htmx/blob/master/LICENSE).