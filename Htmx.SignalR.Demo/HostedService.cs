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
                $"<strong>{Random.Shared.Next(1, 10_000):N0}</strong>",
                cancellationToken: cancellationToken
            );
            await Task.Delay(2000, cancellationToken);
        }
    }
}
