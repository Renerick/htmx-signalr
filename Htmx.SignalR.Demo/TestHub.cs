using Microsoft.AspNetCore.SignalR;

namespace Htmx.SignalR.Demo;

public class TestHub : Hub
{
    public record EchoRequest(string message);

    public async Task Echo(EchoRequest request)
    {
        await Clients.Caller.SendAsync("echo", $@"<div id=""echo"">{request.message}</div><div hx-swap-oob=""true"" id=""echo-oob-data"">{new Random().Next()}</div>");
    }
}
