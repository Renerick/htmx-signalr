using Microsoft.AspNetCore.SignalR;

namespace Htmx.SignalR.Demo;

public class HostedService : BackgroundService
{
    private readonly IHubContext<TestHub> _hubContext;

    public HostedService(IHubContext<TestHub> hubContext)
    {
        _hubContext = hubContext;
    }

    protected override async Task ExecuteAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            await _hubContext.Clients.All.SendAsync(
                "counter",
                $@"<div id=""counter"">{new Random().Next()}</div>",
                cancellationToken: cancellationToken
            );
            await _hubContext.Clients.All.SendAsync(
                "json",
                new { name = "test", id = new Random().Next() },
                cancellationToken: cancellationToken
            );
            await Task.Delay(5000, cancellationToken);
        }
    }
}
