using Htmx.SignalR.Demo;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSignalR();
builder.Services.AddHostedService<HostedService>();
var app = builder.Build();
app.UseStaticFiles();
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(
        Path.Combine(app.Environment.ContentRootPath, "..", "dist")),
    RequestPath = "/extension"
});
app.Map("/", () => Results.Redirect("index.html"));
app.MapHub<TestHub>("/testhub");

app.Run();
