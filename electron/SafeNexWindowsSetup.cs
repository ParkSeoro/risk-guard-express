using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("SafeNex PC 안전관리 메신저")]
[assembly: AssemblyDescription("SafeNex Windows Desktop Messenger & Safety Workspace")]
[assembly: AssemblyCompany("SafeNex")]
[assembly: AssemblyProduct("SafeNex PC")]
[assembly: AssemblyVersion("1.1.1.0")]
[assembly: AssemblyFileVersion("1.1.1.0")]

namespace SafeNexDesktop
{
    static class Program
    {
        private static Mutex _mutex;

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string exePath = Assembly.GetExecutingAssembly().Location;
            string exeName = Path.GetFileName(exePath).ToLowerInvariant();

            bool forceInstall = false;
            bool forceUninstall = false;
            string targetRoute = "/app/admin/desktop-workspace";

            foreach (string arg in args)
            {
                if (arg.Equals("--install", StringComparison.OrdinalIgnoreCase) ||
                    arg.Equals("/install", StringComparison.OrdinalIgnoreCase))
                {
                    forceInstall = true;
                }
                else if (arg.Equals("--uninstall", StringComparison.OrdinalIgnoreCase) ||
                         arg.Equals("/uninstall", StringComparison.OrdinalIgnoreCase))
                {
                    forceUninstall = true;
                }
                else if (arg.StartsWith("--route=", StringComparison.OrdinalIgnoreCase))
                {
                    targetRoute = arg.Substring("--route=".Length);
                }
            }

            string installDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "SafeNexPC"
            );
            string installedExe = Path.Combine(installDir, "SafeNexPC.exe");

            if (forceUninstall)
            {
                RunUninstall(installDir);
                return;
            }

            // If launched as Setup installer OR not running from installDir and user double-clicked Setup
            bool isRunningFromInstallDir = string.Equals(
                Path.GetFullPath(exePath).TrimEnd('\\'),
                Path.GetFullPath(installedExe).TrimEnd('\\'),
                StringComparison.OrdinalIgnoreCase
            );

            if (forceInstall || exeName.Contains("setup") || exeName.Contains("install") || (!isRunningFromInstallDir && !HasWebBundleNextToExe(exePath)))
            {
                Application.Run(new SetupInstallerForm(exePath, installDir, installedExe));
                return;
            }

            // Single-instance check for the tray agent
            bool createdNew;
            _mutex = new Mutex(true, "Local\\SafeNexPC_SingleInstance_Mutex_v1", out createdNew);
            if (!createdNew)
            {
                // Already running -> open the mini messenger window via local server port if active
                int existingPort = ReadSavedPort(installDir);
                if (existingPort > 0)
                {
                    LaunchAppWindow("http://127.0.0.1:" + existingPort + targetRoute, true);
                }
                return;
            }

            Application.Run(new SafeNexTrayContext(exePath, installDir, targetRoute));
        }

        private static bool HasWebBundleNextToExe(string exePath)
        {
            string dir = Path.GetDirectoryName(exePath);
            if (Directory.Exists(Path.Combine(dir, "www")) && File.Exists(Path.Combine(dir, "www", "index.html")))
                return true;
            if (File.Exists(Path.Combine(dir, "webbundle.zip")))
                return true;
            return false;
        }

        public static int ReadSavedPort(string installDir)
        {
            try
            {
                string portFile = Path.Combine(installDir, "server.port");
                if (File.Exists(portFile))
                {
                    int p;
                    if (int.TryParse(File.ReadAllText(portFile).Trim(), out p))
                        return p;
                }
            }
            catch { }
            return 0;
        }

        public static void LaunchAppWindow(string url, bool compactMode)
        {
            try
            {
                string browserExe = FindChromiumBrowser();
                string profileDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "SafeNexPC",
                    "UserProfile"
                );
                Directory.CreateDirectory(profileDir);

                if (!string.IsNullOrEmpty(browserExe))
                {
                    int width = compactMode ? 410 : 1360;
                    int height = compactMode ? 740 : 880;
                    Rectangle workArea = Screen.PrimaryScreen.WorkingArea;
                    int posX = compactMode
                        ? Math.Max(0, workArea.Right - width - 16)
                        : Math.Max(0, workArea.Left + (workArea.Width - width) / 2);
                    int posY = compactMode
                        ? Math.Max(0, workArea.Bottom - height - 16)
                        : Math.Max(0, workArea.Top + (workArea.Height - height) / 2);

                    string args = string.Format(
                        "--app=\"{0}\" --user-data-dir=\"{1}\" --window-size={2},{3} --window-position={4},{5} --disable-features=Translate",
                        url, profileDir, width, height, posX, posY
                    );
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = browserExe,
                        Arguments = args,
                        UseShellExecute = false
                    });
                }
                else
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = url,
                        UseShellExecute = true
                    });
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("창을 여는 중 오류가 발생했습니다: " + ex.Message, "SafeNex PC", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private static string FindChromiumBrowser()
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google\\Chrome\\Application\\chrome.exe")
            };
            foreach (string c in candidates)
            {
                if (File.Exists(c)) return c;
            }
            return null;
        }

        private static void RunUninstall(string installDir)
        {
            try
            {
                RegistryKey runKey = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
                if (runKey != null)
                {
                    runKey.DeleteValue("SafeNexPC", false);
                    runKey.Close();
                }
                string desktopShortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "SafeNex PC 안전관리 메신저.lnk");
                if (File.Exists(desktopShortcut)) File.Delete(desktopShortcut);

                string startMenuShortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "SafeNex PC 안전관리 메신저.lnk");
                if (File.Exists(startMenuShortcut)) File.Delete(startMenuShortcut);

                MessageBox.Show("SafeNex PC 자동 실행 및 바로가기가 제거되었습니다.", "SafeNex PC 제거 완료", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show("제거 중 오류: " + ex.Message);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // 1. Windows Setup Installer GUI (설치 마법사)
    // ─────────────────────────────────────────────────────────────────
    public class SetupInstallerForm : Form
    {
        private readonly string _sourceExe;
        private readonly string _installDir;
        private readonly string _installedExe;
        private CheckBox _chkAutoStart;
        private CheckBox _chkDesktopShortcut;
        private CheckBox _chkCompactMode;
        private CheckBox _chkLaunchNow;
        private ProgressBar _progress;
        private Label _lblStatus;
        private Button _btnInstall;

        public SetupInstallerForm(string sourceExe, string installDir, string installedExe)
        {
            _sourceExe = sourceExe;
            _installDir = installDir;
            _installedExe = installedExe;

            Text = "SafeNex PC 안전관리 메신저 설치 마법사 (v1.1.1)";
            Size = new Size(500, 420);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.White;
            Font = new Font("Malgun Gothic", 9.5f, FontStyle.Regular);

            try
            {
                Icon = Icon.ExtractAssociatedIcon(sourceExe);
            }
            catch { }

            Panel header = new Panel
            {
                Dock = DockStyle.Top,
                Height = 82,
                BackColor = Color.FromArgb(15, 23, 42)
            };

            Label title = new Label
            {
                Text = "SafeNex PC 안전관리 통합 워크스페이스",
                ForeColor = Color.White,
                Font = new Font("Malgun Gothic", 13f, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(22, 18)
            };
            Label subtitle = new Label
            {
                Text = "카카오톡·네이버웍스 스타일 실시간 현장 메신저 & 안전관리 시스템",
                ForeColor = Color.FromArgb(251, 191, 36),
                Font = new Font("Malgun Gothic", 9f, FontStyle.Regular),
                AutoSize = true,
                Location = new Point(24, 48)
            };
            header.Controls.Add(title);
            header.Controls.Add(subtitle);
            Controls.Add(header);

            Label desc = new Label
            {
                Text = "설치 옵션을 선택한 뒤 [설치 및 시작하기] 버튼을 눌러주세요.",
                Location = new Point(24, 98),
                AutoSize = true,
                ForeColor = Color.FromArgb(51, 65, 85),
                Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold)
            };
            Controls.Add(desc);

            _chkAutoStart = new CheckBox
            {
                Text = "윈도우(Windows) 시작 시 SafeNex PC 자동 실행 (권장)",
                Checked = true,
                Location = new Point(28, 132),
                AutoSize = true
            };
            _chkDesktopShortcut = new CheckBox
            {
                Text = "바탕화면 및 시작 메뉴에 바로가기 아이콘 생성",
                Checked = true,
                Location = new Point(28, 162),
                AutoSize = true
            };
            _chkCompactMode = new CheckBox
            {
                Text = "카카오톡처럼 화면 오른쪽 구석에 미니 메신저 창으로 띄우기 (권장)",
                Checked = true,
                Location = new Point(28, 192),
                AutoSize = true
            };
            _chkLaunchNow = new CheckBox
            {
                Text = "설치 완료 후 즉시 SafeNex PC 메신저 실행",
                Checked = true,
                Location = new Point(28, 222),
                AutoSize = true
            };

            Controls.Add(_chkAutoStart);
            Controls.Add(_chkDesktopShortcut);
            Controls.Add(_chkCompactMode);
            Controls.Add(_chkLaunchNow);

            Label pathLabel = new Label
            {
                Text = "설치 경로: " + _installDir,
                Location = new Point(28, 258),
                AutoSize = true,
                ForeColor = Color.Gray,
                Font = new Font("Malgun Gothic", 8.5f)
            };
            Controls.Add(pathLabel);

            _progress = new ProgressBar
            {
                Location = new Point(24, 286),
                Size = new Size(436, 20),
                Style = ProgressBarStyle.Continuous
            };
            Controls.Add(_progress);

            _lblStatus = new Label
            {
                Text = "설치 준비 완료",
                Location = new Point(24, 312),
                AutoSize = true,
                ForeColor = Color.FromArgb(71, 85, 105),
                Font = new Font("Malgun Gothic", 8.5f)
            };
            Controls.Add(_lblStatus);

            _btnInstall = new Button
            {
                Text = "설치 및 시작하기",
                Location = new Point(290, 336),
                Size = new Size(170, 36),
                BackColor = Color.FromArgb(15, 23, 42),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            _btnInstall.Click += OnInstallClick;
            Controls.Add(_btnInstall);
        }

        private void OnInstallClick(object sender, EventArgs e)
        {
            _btnInstall.Enabled = false;
            try
            {
                _lblStatus.Text = "기존 실행 중인 프로세스를 확인하는 중...";
                _progress.Value = 15;
                Application.DoEvents();

                Directory.CreateDirectory(_installDir);

                // Copy executable
                _lblStatus.Text = "실행 파일을 복사하는 중...";
                _progress.Value = 35;
                Application.DoEvents();
                if (!string.Equals(Path.GetFullPath(_sourceExe), Path.GetFullPath(_installedExe), StringComparison.OrdinalIgnoreCase))
                {
                    File.Copy(_sourceExe, _installedExe, true);
                }

                // Extract embedded or adjacent web bundle
                _lblStatus.Text = "카톡형 워크스페이스 웹 번들을 설치하는 중...";
                _progress.Value = 65;
                Application.DoEvents();

                string wwwDir = Path.Combine(_installDir, "www");
                ExtractWebBundleTo(wwwDir);

                // Save preferences
                File.WriteAllText(
                    Path.Combine(_installDir, "mode.cfg"),
                    _chkCompactMode.Checked ? "compact" : "expanded",
                    Encoding.UTF8
                );

                // Register Windows Startup
                _lblStatus.Text = "윈도우 시작 프로그램 및 바로가기를 등록하는 중...";
                _progress.Value = 85;
                Application.DoEvents();

                SetAutoStartRegistry(_chkAutoStart.Checked, _installedExe);

                if (_chkDesktopShortcut.Checked)
                {
                    string desktopLink = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "SafeNex PC 안전관리 메신저.lnk");
                    CreateShortcut(desktopLink, _installedExe, _installDir, "SafeNex PC 안전관리 메신저");

                    string startMenuLink = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "SafeNex PC 안전관리 메신저.lnk");
                    CreateShortcut(startMenuLink, _installedExe, _installDir, "SafeNex PC 안전관리 메신저");
                }

                _progress.Value = 100;
                _lblStatus.Text = "설치가 완료되었습니다!";
                Application.DoEvents();

                if (_chkLaunchNow.Checked)
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = _installedExe,
                        WorkingDirectory = _installDir,
                        UseShellExecute = true
                    });
                }
                else
                {
                    MessageBox.Show("SafeNex PC 설치가 완료되었습니다.\n바탕화면의 아이콘을 눌러 언제든 실행하실 수 있습니다.", "설치 완료", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }

                Close();
            }
            catch (Exception ex)
            {
                _btnInstall.Enabled = true;
                MessageBox.Show("설치 중 오류가 발생했습니다:\n" + ex.Message, "SafeNex PC 설치 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        public static void ExtractWebBundleTo(string wwwDir)
        {
            string tempZip = Path.Combine(Path.GetTempPath(), "safenex_webbundle_" + Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                using (Stream resStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("webbundle.zip"))
                {
                    if (resStream != null)
                    {
                        using (FileStream fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write))
                        {
                            resStream.CopyTo(fs);
                        }
                    }
                    else
                    {
                        string localZip = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), "webbundle.zip");
                        if (File.Exists(localZip))
                        {
                            File.Copy(localZip, tempZip, true);
                        }
                    }
                }

                if (File.Exists(tempZip))
                {
                    if (Directory.Exists(wwwDir))
                    {
                        try { Directory.Delete(wwwDir, true); } catch { }
                    }
                    Directory.CreateDirectory(wwwDir);
                    ZipFile.ExtractToDirectory(tempZip, wwwDir);
                }
            }
            finally
            {
                if (File.Exists(tempZip))
                {
                    try { File.Delete(tempZip); } catch { }
                }
            }
        }

        public static void SetAutoStartRegistry(bool enable, string exePath)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key != null)
                    {
                        if (enable)
                            key.SetValue("SafeNexPC", "\"" + exePath + "\"");
                        else
                            key.DeleteValue("SafeNexPC", false);
                    }
                }
            }
            catch { }
        }

        public static bool GetAutoStartRegistry()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false))
                {
                    if (key != null)
                    {
                        object val = key.GetValue("SafeNexPC");
                        return val != null;
                    }
                }
            }
            catch { }
            return false;
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string description)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.WorkingDirectory = workingDir;
                shortcut.Description = description;
                shortcut.IconLocation = targetPath + ",0";
                shortcut.Save();
            }
            catch { }
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // 2. System Tray Resident Agent + Embedded Local SPA HTTP Server
    // ─────────────────────────────────────────────────────────────────
    public class SafeNexTrayContext : ApplicationContext
    {
        private readonly string _exePath;
        private readonly string _installDir;
        private readonly string _wwwDir;
        private readonly NotifyIcon _trayIcon;
        private HttpListener _listener;
        private Thread _serverThread;
        private int _port = 45780;
        private bool _isRunning = true;

        public SafeNexTrayContext(string exePath, string installDir, string initialRoute)
        {
            _exePath = exePath;
            _installDir = installDir;
            Directory.CreateDirectory(_installDir);

            _wwwDir = Path.Combine(_installDir, "www");
            if (!Directory.Exists(_wwwDir) || !File.Exists(Path.Combine(_wwwDir, "index.html")))
            {
                SetupInstallerForm.ExtractWebBundleTo(_wwwDir);
            }

            StartLocalSpaServer();

            Icon appIcon = SystemIcons.Shield;
            try
            {
                appIcon = Icon.ExtractAssociatedIcon(_exePath) ?? SystemIcons.Shield;
            }
            catch { }

            ContextMenuStrip menu = BuildContextMenu();

            _trayIcon = new NotifyIcon
            {
                Icon = appIcon,
                Text = "SafeNex PC 안전관리 메신저 (실행 중)",
                Visible = true,
                ContextMenuStrip = menu
            };

            _trayIcon.DoubleClick += (s, e) => OpenWorkspace("/app/admin/desktop-workspace", true);

            bool startCompact = true;
            try
            {
                string cfg = Path.Combine(_installDir, "mode.cfg");
                if (File.Exists(cfg) && File.ReadAllText(cfg).Trim() == "expanded")
                    startCompact = false;
            }
            catch { }

            OpenWorkspace(initialRoute, startCompact);
        }

        private ContextMenuStrip BuildContextMenu()
        {
            ContextMenuStrip menu = new ContextMenuStrip();

            ToolStripMenuItem openMiniItem = new ToolStripMenuItem("💬 SafeNex 카톡형 미니 메신저 열기 (오른쪽 구석)");
            openMiniItem.Font = new Font(menu.Font, FontStyle.Bold);
            openMiniItem.Click += (s, e) => OpenWorkspace("/app/admin/desktop-workspace", true);
            menu.Items.Add(openMiniItem);

            ToolStripMenuItem openFullItem = new ToolStripMenuItem("🖥️ 넓은 분할 화면으로 열기");
            openFullItem.Click += (s, e) => OpenWorkspace("/app/admin/desktop-workspace", false);
            menu.Items.Add(openFullItem);

            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem approvalsItem = new ToolStripMenuItem("✅ 전자결재함 바로가기");
            approvalsItem.Click += (s, e) => OpenWorkspace("/app/admin/desktop-workspace?module=approvals", false);
            menu.Items.Add(approvalsItem);

            ToolStripMenuItem safetyCostItem = new ToolStripMenuItem("🧾 산업안전보건관리비 바로가기");
            safetyCostItem.Click += (s, e) => OpenWorkspace("/app/admin/desktop-workspace?module=safety-cost", false);
            menu.Items.Add(safetyCostItem);

            ToolStripMenuItem permitsItem = new ToolStripMenuItem("📝 작업허가서(PTW) 바로가기");
            permitsItem.Click += (s, e) => OpenWorkspace("/app/admin/desktop-workspace?module=work-permits", false);
            menu.Items.Add(permitsItem);

            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem autoStartItem = new ToolStripMenuItem("윈도우 시작 시 자동 실행")
            {
                Checked = SetupInstallerForm.GetAutoStartRegistry(),
                CheckOnClick = true
            };
            autoStartItem.CheckedChanged += (s, e) =>
            {
                SetupInstallerForm.SetAutoStartRegistry(autoStartItem.Checked, _exePath);
            };
            menu.Items.Add(autoStartItem);

            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem exitItem = new ToolStripMenuItem("SafeNex PC 완전 종료");
            exitItem.Click += (s, e) => ExitApplication();
            menu.Items.Add(exitItem);

            return menu;
        }

        private void OpenWorkspace(string route, bool compact)
        {
            string url = "http://127.0.0.1:" + _port + route;
            Program.LaunchAppWindow(url, compact);
        }

        private void StartLocalSpaServer()
        {
            for (int p = 45780; p < 45810; p++)
            {
                try
                {
                    HttpListener listener = new HttpListener();
                    listener.Prefixes.Add("http://127.0.0.1:" + p + "/");
                    listener.Start();
                    _listener = listener;
                    _port = p;
                    File.WriteAllText(Path.Combine(_installDir, "server.port"), _port.ToString(), Encoding.ASCII);
                    break;
                }
                catch
                {
                    continue;
                }
            }

            if (_listener == null) return;

            _serverThread = new Thread(ServerLoop)
            {
                IsBackground = true
            };
            _serverThread.Start();
        }

        private void ServerLoop()
        {
            while (_isRunning && _listener != null && _listener.IsListening)
            {
                try
                {
                    HttpListenerContext ctx = _listener.GetContext();
                    ThreadPool.QueueUserWorkItem(_ => HandleRequest(ctx));
                }
                catch
                {
                    if (!_isRunning) break;
                }
            }
        }

        private void HandleRequest(HttpListenerContext ctx)
        {
            try
            {
                string rawPath = ctx.Request.Url.AbsolutePath;
                if (string.IsNullOrEmpty(rawPath) || rawPath == "/")
                    rawPath = "/index.html";

                string relativePath = rawPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                string filePath = Path.Combine(_wwwDir, relativePath);

                // SPA fallback: if not a static asset file, serve index.html
                if (!File.Exists(filePath))
                {
                    filePath = Path.Combine(_wwwDir, "index.html");
                }

                if (!File.Exists(filePath))
                {
                    ctx.Response.StatusCode = 404;
                    ctx.Response.Close();
                    return;
                }

                string ext = Path.GetExtension(filePath).ToLowerInvariant();
                ctx.Response.ContentType = GetMimeType(ext);
                ctx.Response.StatusCode = 200;

                if (ext == ".html")
                {
                    // Inject window.safenexDesktop marker so the React UI knows it is running inside the native Windows .exe!
                    string html = File.ReadAllText(filePath, Encoding.UTF8);
                    string bridgeScript = "<script>window.safenexDesktop={isDesktopApp:true,platform:'win32',appVersion:'1.1.1'};</script>";
                    html = html.Replace("<head>", "<head>" + bridgeScript);
                    byte[] bytes = Encoding.UTF8.GetBytes(html);
                    ctx.Response.ContentLength64 = bytes.Length;
                    ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                }
                else
                {
                    byte[] bytes = File.ReadAllBytes(filePath);
                    ctx.Response.ContentLength64 = bytes.Length;
                    ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                }
                ctx.Response.OutputStream.Close();
            }
            catch
            {
                try { ctx.Response.Close(); } catch { }
            }
        }

        private static string GetMimeType(string ext)
        {
            switch (ext)
            {
                case ".html": return "text/html; charset=utf-8";
                case ".js":
                case ".mjs": return "application/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".png": return "image/png";
                case ".jpg":
                case ".jpeg": return "image/jpeg";
                case ".svg": return "image/svg+xml";
                case ".ico": return "image/x-icon";
                case ".woff": return "font/woff";
                case ".woff2": return "font/woff2";
                case ".ttf": return "font/ttf";
                default: return "application/octet-stream";
            }
        }

        private void ExitApplication()
        {
            _isRunning = false;
            try
            {
                if (_trayIcon != null) _trayIcon.Visible = false;
                if (_listener != null) _listener.Stop();
            }
            catch { }
            Application.Exit();
        }
    }
}
