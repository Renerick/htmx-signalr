using Htmx.SignalR.Demo;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSignalR();
builder.Services.AddHostedService<HostedService>();
var app = builder.Build();
app.UseStaticFiles();
app.MapHub<TestHub>("/testhub");

app.Run();
