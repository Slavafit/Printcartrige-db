using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;

namespace PrinterDB.Launcher;

internal static class Program
{
    private const string MutexName = @"Local\PrinterDB.LightweightLauncher";
    internal const string ShutdownEventName = @"Local\PrinterDB.LightweightLauncher.Shutdown";

    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        using var mutex = new Mutex(true, MutexName, out var firstInstance);
        if (!firstInstance)
        {
            if (args.Contains("--shutdown", StringComparer.OrdinalIgnoreCase))
            {
                try { EventWaitHandle.OpenExisting(ShutdownEventName).Set(); } catch { }
            }
            else OpenExistingInstance();
            return;
        }
        Application.Run(new TrayApplicationContext(mutex));
    }

    private static void OpenExistingInstance()
    {
        var root = Environment.GetEnvironmentVariable("PRINTERDB_DATA_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PrinterDB");
        var statePath = Path.Combine(root, "lightweight-launcher.json");
        for (var attempt = 0; attempt < 30; attempt++)
        {
            try
            {
                var state = JsonSerializer.Deserialize<LauncherState>(File.ReadAllText(statePath));
                if (state is not null) { OpenBrowser(state.Url); return; }
            }
            catch { Thread.Sleep(100); }
        }
    }

    internal static void OpenBrowser(string url) => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    internal sealed record LauncherState(string Url, int ProcessId);
}

internal sealed class TrayApplicationContext : ApplicationContext
{
    private readonly Mutex mutex;
    private readonly NotifyIcon tray;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly string dataRoot;
    private readonly string statePath;
    private readonly string token = Guid.NewGuid().ToString("N");
    private readonly Control dispatcher = new();
    private readonly EventWaitHandle shutdownEvent;
    private readonly RegisteredWaitHandle shutdownRegistration;
    private Process? server;
    private string? url;
    private bool exiting;

    internal TrayApplicationContext(Mutex mutex)
    {
        this.mutex = mutex;
        dataRoot = Environment.GetEnvironmentVariable("PRINTERDB_DATA_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PrinterDB");
        statePath = Path.Combine(dataRoot, "lightweight-launcher.json");
        _ = dispatcher.Handle;
        shutdownEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShutdownEventName);
        tray = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "PrinterDB — запуск…",
            Visible = true,
            ContextMenuStrip = BuildMenu()
        };
        tray.DoubleClick += (_, _) => OpenCatalog();
        shutdownRegistration = ThreadPool.RegisterWaitForSingleObject(shutdownEvent, (_, _) => dispatcher.BeginInvoke(() => _ = ExitAsync()), null, Timeout.Infinite, false);
        _ = StartAsync();
    }

    private ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Открыть справочник", null, (_, _) => OpenCatalog());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Выход", null, async (_, _) => await ExitAsync());
        return menu;
    }

    private async Task StartAsync()
    {
        try
        {
            Directory.CreateDirectory(dataRoot);
            var appRoot = Path.Combine(AppContext.BaseDirectory, "app");
            var databasePath = Path.Combine(dataRoot, "printcartridge.sqlite");
            var seedPath = Path.Combine(appRoot, "seed.sqlite");
            if (!File.Exists(databasePath) && File.Exists(seedPath)) File.Copy(seedPath, databasePath);

            var port = FindFreePort(4173);
            url = $"http://127.0.0.1:{port}";
            var start = new ProcessStartInfo(Path.Combine(appRoot, "node.exe"), Path.Combine(appRoot, "server.cjs"))
            {
                WorkingDirectory = appRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            start.Environment["PORT"] = port.ToString();
            start.Environment["WEB_DB_PATH"] = databasePath;
            start.Environment["WEB_STATIC_ROOT"] = Path.Combine(appRoot, "web-dist");
            start.Environment["WEB_BACKUP_ROOT"] = Path.Combine(dataRoot, "backups");
            start.Environment["LAUNCHER_SHUTDOWN_TOKEN"] = token;
            server = Process.Start(start) ?? throw new InvalidOperationException("Не удалось запустить встроенный Node.js");
            server.EnableRaisingEvents = true;
            server.Exited += (_, _) => { if (!exiting) BeginInvokeExit("Локальный сервер неожиданно завершился."); };

            for (var attempt = 0; attempt < 60; attempt++)
            {
                try { if ((await http.GetAsync($"{url}/api/stats")).IsSuccessStatusCode) break; }
                catch when (attempt < 59) { }
                if (attempt == 59) throw new TimeoutException("Локальный сервер не ответил вовремя");
                await Task.Delay(100);
            }
            File.WriteAllText(statePath, JsonSerializer.Serialize(new Program.LauncherState(url, Environment.ProcessId)));
            tray.Text = "PrinterDB";
            Program.OpenBrowser(url);
        }
        catch (Exception error) { BeginInvokeExit(error.Message); }
    }

    private void BeginInvokeExit(string message)
    {
        dispatcher.BeginInvoke(() =>
        {
            MessageBox.Show(message, "PrinterDB", MessageBoxButtons.OK, MessageBoxIcon.Error);
            _ = ExitAsync();
        });
    }

    private void OpenCatalog() { if (url is not null) Program.OpenBrowser(url); }

    private async Task ExitAsync()
    {
        if (exiting) return;
        exiting = true;
        tray.Visible = false;
        try
        {
            if (url is not null && server is { HasExited: false })
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, $"{url}/api/launcher/shutdown");
                request.Headers.Add("X-PrinterDB-Token", token);
                await http.SendAsync(request);
                if (!server.WaitForExit(5000)) server.Kill(true);
            }
        }
        catch { if (server is { HasExited: false }) server.Kill(true); }
        try { File.Delete(statePath); } catch { }
        shutdownRegistration.Unregister(null); shutdownEvent.Dispose();
        dispatcher.Dispose(); tray.Dispose(); http.Dispose(); server?.Dispose();
        mutex.ReleaseMutex();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !exiting) _ = ExitAsync();
        base.Dispose(disposing);
    }

    private static int FindFreePort(int start)
    {
        for (var port = start; port < start + 20; port++)
        {
            try { var listener = new TcpListener(IPAddress.Loopback, port); listener.Start(); listener.Stop(); return port; }
            catch (SocketException) { }
        }
        throw new InvalidOperationException("Нет свободного локального порта");
    }
}
