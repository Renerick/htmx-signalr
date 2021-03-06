using Htmx.SignalR.Demo;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSignalR();
builder.Services.AddHostedService<HostedService>();
var app = builder.Build();
app.UseStaticFiles();
app.MapGet(
    "/",
    () => Results.Extensions.Html(
        @"
<!doctype html>
<html lang=""en"">
<head>
    <meta charset=""UTF-8"">
    <meta name=""viewport"" content=""width=device-width, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0"">
    <meta http-equiv=""X-UA-Compatible"" content=""ie=edge"">
    <title>Test page</title>
    <style>.htmx-settling{background:pink;}</style>
</head>
<body>
    <div hx-ext=""signalr,client-side-templates"" signalr-connect=""/testhub"">
        <div signalr-subscribe=""counter"">
            <div id=""counter""></div>
        </div>
        <form signalr-send=""echo"">
            <input type=""text"" name=""message"">
            <button type=""submit"">Submit</button>
        </form>
        <div signalr-subscribe=""echo"" hx-target=""#echo-target"" hx-swap=""beforeend"">
        </div>
        <h2>Echo target is below</h2>
        <div id=""echo-target""></div>
        <h2>Echo oob data is below</h2>
        <div id=""echo-oob-data""></div>
        <hr>
        <h2>Transform response test (Mustache client side tempaltes)</h2>
        <div mustache-template=""foo"" signalr-subscribe=""json"">
        </div>
        <template id=""foo"">
            <div id=""json"">{{name}} - {{id}} </div>
        </template>
    </div>
    <script src=""https://cdn.jsdelivr.net/gh/bigskysoftware/htmx@dev/src/htmx.js""></script>
    <script src=""https://unpkg.com/@microsoft/signalr@next/dist/browser/signalr.js""></script>
    <script src=""/hx-signalr.js""></script>
    <script src=""https://unpkg.com/htmx.org/dist/ext/client-side-templates.js""></script>
    <script src=""https://unpkg.com/mustache@latest""></script>
</body>
</html>
"
    )
);
app.MapHub<TestHub>("/testhub");

app.Run();
