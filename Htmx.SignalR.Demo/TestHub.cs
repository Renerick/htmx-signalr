using System.Text.Encodings.Web;
using Microsoft.AspNetCore.SignalR;

namespace Htmx.SignalR.Demo;

public class TestHub : Hub
{
    public record EchoRequest(string Message);

    public async Task Echo(EchoRequest request)
    {
        var message = HtmlEncoder.Default.Encode(request.Message);

        await Clients.Caller.SendAsync("echo",
            $"<p class=\"message\">{message}</p>" +
            $"<p id=\"raw-status\" hx-swap-oob=\"true\">Last raw message: {message}</p>"
        );
    }

    public async Task StructuredEcho(EchoRequest request)
    {
        var message = HtmlEncoder.Default.Encode(request.Message);

        await Clients.Caller.SendAsync("structuredEcho", new
        {
            content = $"<div><p class=\"message\">{message}</p><small>This is removed by select.</small></div>",
            target = "#structured-messages",
            swap = "beforeend settle:10ms",
            select = ".message"
        });
    }
}
