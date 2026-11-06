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
[assembly: AssemblyVersion("1.1.5.0")]
[assembly: AssemblyFileVersion("1.1.5.0")]

namespace SafeNexDesktop
{
    static class AppConstants
    {
        public const string APP_VERSION = "1.1.5";
        public const string PUBLIC_SITE_URL = "https://safenex.org/app/admin";
        public const int MESSENGER_WIDTH = 420;
        public const int MESSENGER_HEIGHT = 680;
        public const int WORK_WIDTH = 1260;
        public const int WORK_HEIGHT = 820;
    }
    static class Win32WindowHelper
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

        public static void ResizeActiveAppWindow(int targetWidth, int targetHeight)
        {
            try
            {
                IntPtr hWnd = GetForegroundWindow();
                if (hWnd == IntPtr.Zero) return;

                RECT rect;
                if (!GetWindowRect(hWnd, out rect)) return;

                Screen scr = Screen.FromHandle(hWnd);
                Rectangle work = scr.WorkingArea;

                int w = Math.Min(Math.Max(360, targetWidth), work.Width - 20);
                int h = Math.Min(Math.Max(520, targetHeight), work.Height - 20);

                // Keep right edge anchored so expanding from 420 -> 960 shifts left cleanly
                int curRight = rect.Right;
                int nextX = curRight - w;
                if (nextX + w > work.Right - 12)
                    nextX = work.Right - w - 16;
                if (nextX < work.Left + 12)
                    nextX = work.Left + 16;

                int nextY = rect.Top;
                if (nextY + h > work.Bottom - 12)
                    nextY = Math.Max(work.Top + 16, work.Bottom - h - 16);
                if (nextY < work.Top + 12)
                    nextY = work.Top + 16;

                MoveWindow(hWnd, nextX, nextY, w, h, true);
            }
            catch { }
        }
    }

    static class Program
    {
        private static Mutex _mutex;

        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                // Enable TLS 1.2 for HTTPS OTA bundle downloads from Supabase Storage / GitHub
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;
            }
            catch { }

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
                int existingPort = ReadSavedPort(installDir);
                if (existingPort > 0)
                {
                    LaunchAppWindow("http://127.0.0.1:" + existingPort + targetRoute + (targetRoute.Contains("?") ? "&" : "?") + "pcboot=" + DateTime.UtcNow.Ticks, 420, 680);
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

        public static void LaunchAppWindow(string url, int width, int height)
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
                    Rectangle workArea = Screen.PrimaryScreen.WorkingArea;
                    int posX = Math.Max(16, workArea.Right - width - 20);
                    int posY = Math.Max(16, workArea.Bottom - height - 20);

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
        private CheckBox _chkLaunchNow;
        private ProgressBar _progress;
        private Label _lblStatus;
        private Button _btnInstall;

        public SetupInstallerForm(string sourceExe, string installDir, string installedExe)
        {
            _sourceExe = sourceExe;
            _installDir = installDir;
            _installedExe = installedExe;

            Text = "SafeNex PC 안전관리 메신저 설치 마법사 (v" + AppConstants.APP_VERSION + ")";
            Size = new Size(500, 390);
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
                Text = "SafeNex PC 안전관리 메신저",
                ForeColor = Color.White,
                Font = new Font("Malgun Gothic", 13f, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(22, 18)
            };
            Label subtitle = new Label
            {
                Text = "실시간 현장 대화상대 · 채팅 · 전자결재 · 안전서류 통합 프로그램",
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
                Text = "설치 옵션을 확인한 뒤 [설치 및 시작하기] 버튼을 눌러주세요.",
                Location = new Point(24, 98),
                AutoSize = true,
                ForeColor = Color.FromArgb(51, 65, 85),
                Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold)
            };
            Controls.Add(desc);

            _chkAutoStart = new CheckBox
            {
                Text = "윈도우(Windows) 시작 시 SafeNex PC 자동 실행 (로그인 유지)",
                Checked = true,
                Location = new Point(28, 134),
                AutoSize = true
            };
            _chkDesktopShortcut = new CheckBox
            {
                Text = "바탕화면 및 시작 메뉴에 바로가기 아이콘 생성",
                Checked = true,
                Location = new Point(28, 166),
                AutoSize = true
            };
            _chkLaunchNow = new CheckBox
            {
                Text = "설치 완료 후 즉시 SafeNex PC 실행",
                Checked = true,
                Location = new Point(28, 198),
                AutoSize = true
            };

            Controls.Add(_chkAutoStart);
            Controls.Add(_chkDesktopShortcut);
            Controls.Add(_chkLaunchNow);

            Label pathLabel = new Label
            {
                Text = "설치 경로: " + _installDir,
                Location = new Point(28, 234),
                AutoSize = true,
                ForeColor = Color.Gray,
                Font = new Font("Malgun Gothic", 8.5f)
            };
            Controls.Add(pathLabel);

            _progress = new ProgressBar
            {
                Location = new Point(24, 260),
                Size = new Size(436, 20),
                Style = ProgressBarStyle.Continuous
            };
            Controls.Add(_progress);

            _lblStatus = new Label
            {
                Text = "설치 준비 완료",
                Location = new Point(24, 286),
                AutoSize = true,
                ForeColor = Color.FromArgb(71, 85, 105),
                Font = new Font("Malgun Gothic", 8.5f)
            };
            Controls.Add(_lblStatus);

            _btnInstall = new Button
            {
                Text = "설치 및 시작하기",
                Location = new Point(290, 308),
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
                _lblStatus.Text = "기존 실행 중인 프로세스를 종료하는 중...";
                _progress.Value = 15;
                Application.DoEvents();

                // Stop any existing SafeNexPC instance so file copy succeeds
                try
                {
                    int currentPid = Process.GetCurrentProcess().Id;
                    foreach (Process p in Process.GetProcesses())
                    {
                        if (p.Id == currentPid) continue;
                        try
                        {
                            string path = p.MainModule.FileName;
                            if (string.IsNullOrEmpty(path)) continue;
                            bool ours = path.StartsWith(_installDir, StringComparison.OrdinalIgnoreCase)
                                || string.Equals(Path.GetFileNameWithoutExtension(path), "SafeNexPC", StringComparison.OrdinalIgnoreCase);
                            if (!ours) continue;
                            p.Kill();
                            p.WaitForExit(2000);
                        }
                        catch { }
                    }
                }
                catch { }
                System.Threading.Thread.Sleep(400);

                Directory.CreateDirectory(_installDir);

                _lblStatus.Text = "실행 파일을 복사하는 중...";
                _progress.Value = 35;
                Application.DoEvents();
                if (!string.Equals(Path.GetFullPath(_sourceExe), Path.GetFullPath(_installedExe), StringComparison.OrdinalIgnoreCase))
                {
                    File.Copy(_sourceExe, _installedExe, true);
                }

                _lblStatus.Text = "프로그램 리소스를 설치하는 중...";
                _progress.Value = 65;
                Application.DoEvents();

                string wwwDir = Path.Combine(_installDir, "www");
                ExtractWebBundleTo(wwwDir);
                try
                {
                    File.WriteAllText(Path.Combine(_installDir, "exe-version.txt"), AppConstants.APP_VERSION, Encoding.UTF8);
                    File.WriteAllText(Path.Combine(wwwDir, "bundle-version.txt"), AppConstants.APP_VERSION, Encoding.UTF8);
                    string pendingDir = Path.Combine(_installDir, "www_next");
                    if (Directory.Exists(pendingDir)) Directory.Delete(pendingDir, true);
                    string pendingVersion = Path.Combine(_installDir, "www_next_version.txt");
                    if (File.Exists(pendingVersion)) File.Delete(pendingVersion);
                }
                catch { }

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
            string staging = wwwDir + "_new";
            try
            {
                Assembly asm = Assembly.GetExecutingAssembly();
                Stream resStream = asm.GetManifestResourceStream("SafeNex.webbundle.zip")
                                ?? asm.GetManifestResourceStream("webbundle.zip");
                if (resStream == null)
                {
                    foreach (string name in asm.GetManifestResourceNames())
                    {
                        if (name.EndsWith("webbundle.zip", StringComparison.OrdinalIgnoreCase))
                        {
                            resStream = asm.GetManifestResourceStream(name);
                            break;
                        }
                    }
                }
                if (resStream != null)
                {
                    using (resStream)
                    using (FileStream fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write))
                    {
                        resStream.CopyTo(fs);
                    }
                }
                else
                {
                    string localZip = Path.Combine(Path.GetDirectoryName(asm.Location), "webbundle.zip");
                    if (File.Exists(localZip))
                        File.Copy(localZip, tempZip, true);
                }

                if (!File.Exists(tempZip) || new FileInfo(tempZip).Length < 512)
                    throw new InvalidOperationException("설치 파일 안에 새 화면이 없습니다. 설치 파일을 다시 받아 주세요.");

                if (Directory.Exists(staging))
                    Directory.Delete(staging, true);
                Directory.CreateDirectory(staging);
                ZipFile.ExtractToDirectory(tempZip, staging);
                if (!File.Exists(Path.Combine(staging, "index.html")))
                    throw new InvalidOperationException("새 화면에 시작 파일이 없습니다. 설치 파일을 다시 받아 주세요.");

                if (Directory.Exists(wwwDir))
                {
                    try { Directory.Delete(wwwDir, true); }
                    catch { }
                }
                if (!Directory.Exists(wwwDir))
                {
                    Directory.Move(staging, wwwDir);
                }
                else
                {
                    CopyTree(staging, wwwDir);
                    try { Directory.Delete(staging, true); } catch { }
                }
                if (!File.Exists(Path.Combine(wwwDir, "index.html")))
                    throw new InvalidOperationException("실행 중인 SafeNex 창을 모두 닫은 뒤 설치 파일을 다시 실행해 주세요.");
            }
            finally
            {
                if (File.Exists(tempZip))
                {
                    try { File.Delete(tempZip); } catch { }
                }
            }
        }

        private static void CopyTree(string sourceDir, string targetDir)
        {
            Directory.CreateDirectory(targetDir);
            foreach (string file in Directory.GetFiles(sourceDir))
            {
                string destFile = Path.Combine(targetDir, Path.GetFileName(file));
                File.Copy(file, destFile, true);
            }
            foreach (string subDir in Directory.GetDirectories(sourceDir))
            {
                CopyTree(subDir, Path.Combine(targetDir, Path.GetFileName(subDir)));
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
            EnsureWebBundleInitialized();
            ApplyPendingWebBundle();

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

            _trayIcon.DoubleClick += (s, e) => OpenWorkspace("/app/admin/desktop-workspace", AppConstants.MESSENGER_WIDTH, AppConstants.MESSENGER_HEIGHT);

            OpenWorkspace(initialRoute, AppConstants.MESSENGER_WIDTH, AppConstants.MESSENGER_HEIGHT);
        }

        private void EnsureWebBundleInitialized()
        {
            try
            {
                string exeVerFile = Path.Combine(_installDir, "exe-version.txt");
                string indexFile = Path.Combine(_wwwDir, "index.html");
                string bundleVerFile = Path.Combine(_wwwDir, "bundle-version.txt");

                string installedExeVer = File.Exists(exeVerFile) ? File.ReadAllText(exeVerFile, Encoding.UTF8).Trim() : "";

                // Extract built-in bundle only if www/index.html is missing OR the .exe binary itself was upgraded.
                // This preserves any newer OTA web bundles downloaded automatically in the background!
                if (!File.Exists(indexFile) || !string.Equals(installedExeVer, AppConstants.APP_VERSION, StringComparison.OrdinalIgnoreCase))
                {
                    SetupInstallerForm.ExtractWebBundleTo(_wwwDir);
                    File.WriteAllText(exeVerFile, AppConstants.APP_VERSION, Encoding.UTF8);
                    if (!File.Exists(bundleVerFile))
                    {
                        File.WriteAllText(bundleVerFile, AppConstants.APP_VERSION, Encoding.UTF8);
                    }
                }
            }
            catch { }
        }

        private string GetCurrentBundleVersion()
        {
            try
            {
                string bundleVerFile = Path.Combine(_wwwDir, "bundle-version.txt");
                if (File.Exists(bundleVerFile))
                {
                    string v = File.ReadAllText(bundleVerFile, Encoding.UTF8).Trim();
                    if (!string.IsNullOrEmpty(v)) return v;
                }
            }
            catch { }
            return AppConstants.APP_VERSION;
        }

        private static string RawQueryValue(HttpListenerRequest req, string key)
        {
            string raw = req.RawUrl ?? "";
            int q = raw.IndexOf('?');
            if (q >= 0)
            {
                string[] parts = raw.Substring(q + 1).Split('&');
                foreach (string part in parts)
                {
                    int eq = part.IndexOf('=');
                    if (eq <= 0) continue;
                    string name = Uri.UnescapeDataString(part.Substring(0, eq).Replace("+", " "));
                    if (!string.Equals(name, key, StringComparison.OrdinalIgnoreCase)) continue;
                    return Uri.UnescapeDataString(part.Substring(eq + 1).Replace("+", " "));
                }
            }
            return req.QueryString[key] ?? "";
        }

        private string PendingWebDir
        {
            get { return Path.Combine(_installDir, "www_next"); }
        }

        private void ApplyPendingWebBundle()
        {
            try
            {
                string pending = PendingWebDir;
                if (!Directory.Exists(pending)) return;
                string source = BundleSourceDir(pending);
                if (source == null) return;

                string versionFile = Path.Combine(_installDir, "www_next_version.txt");
                string version = File.Exists(versionFile) ? File.ReadAllText(versionFile, Encoding.UTF8).Trim() : "";
                if (!string.IsNullOrEmpty(version))
                    File.WriteAllText(Path.Combine(source, "bundle-version.txt"), version, Encoding.UTF8);

                string oldDir = Path.Combine(_installDir, "www_old");
                try { if (Directory.Exists(oldDir)) Directory.Delete(oldDir, true); } catch { }
                if (Directory.Exists(_wwwDir))
                {
                    try { Directory.Move(_wwwDir, oldDir); }
                    catch { try { Directory.Delete(_wwwDir, true); } catch { } }
                }

                if (string.Equals(source, pending, StringComparison.OrdinalIgnoreCase))
                    Directory.Move(pending, _wwwDir);
                else
                {
                    Directory.CreateDirectory(_wwwDir);
                    CopyDirectoryRecursive(source, _wwwDir);
                    try { Directory.Delete(pending, true); } catch { }
                }
                try { if (File.Exists(versionFile)) File.Delete(versionFile); } catch { }
                try { if (Directory.Exists(oldDir)) Directory.Delete(oldDir, true); } catch { }
            }
            catch { }
        }

        private static string BundleSourceDir(string root)
        {
            if (File.Exists(Path.Combine(root, "index.html"))) return root;
            string[] subDirs = Directory.Exists(root) ? Directory.GetDirectories(root) : new string[0];
            if (subDirs.Length == 1 && File.Exists(Path.Combine(subDirs[0], "index.html"))) return subDirs[0];
            return null;
        }

        private bool StageOtaFromZipFile(string newVersion, string tempZip, out string errorMsg)
        {
            errorMsg = null;
            string stagingDir = Path.Combine(_installDir, "www_stage_" + Guid.NewGuid().ToString("N"));
            try
            {
                if (string.IsNullOrEmpty(newVersion))
                {
                    errorMsg = "업데이트 버전을 확인하지 못했습니다.";
                    return false;
                }
                if (!File.Exists(tempZip) || new FileInfo(tempZip).Length < 512)
                {
                    errorMsg = "업데이트 파일을 받지 못했습니다.";
                    return false;
                }

                Directory.CreateDirectory(stagingDir);
                ZipFile.ExtractToDirectory(tempZip, stagingDir);
                string source = BundleSourceDir(stagingDir);
                if (source == null)
                {
                    errorMsg = "업데이트 번들에 index.html이 포함되어 있지 않습니다.";
                    return false;
                }

                File.WriteAllText(Path.Combine(source, "bundle-version.txt"), newVersion, Encoding.UTF8);
                string pending = PendingWebDir;
                if (Directory.Exists(pending))
                {
                    try { Directory.Delete(pending, true); } catch { }
                }
                if (Directory.Exists(pending))
                {
                    errorMsg = "이전 업데이트를 치우지 못했습니다. 프로그램을 완전히 종료한 뒤 다시 열어 주세요.";
                    return false;
                }
                if (string.Equals(source, stagingDir, StringComparison.OrdinalIgnoreCase))
                    Directory.Move(stagingDir, pending);
                else
                {
                    Directory.CreateDirectory(pending);
                    CopyDirectoryRecursive(source, pending);
                }
                File.WriteAllText(Path.Combine(_installDir, "www_next_version.txt"), newVersion, Encoding.UTF8);
                return true;
            }
            catch
            {
                errorMsg = "업데이트 파일을 받지 못했습니다.";
                return false;
            }
            finally
            {
                try { if (Directory.Exists(stagingDir) && !string.Equals(stagingDir, PendingWebDir, StringComparison.OrdinalIgnoreCase)) Directory.Delete(stagingDir, true); } catch { }
            }
        }

        private bool StageOtaFromDownload(string newVersion, string downloadUrl, out string errorMsg)
        {
            errorMsg = null;
            string tempZip = Path.Combine(Path.GetTempPath(), "safenex_ota_" + Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                if (string.IsNullOrEmpty(downloadUrl) || downloadUrl.IndexOf("http", StringComparison.OrdinalIgnoreCase) != 0)
                {
                    errorMsg = "업데이트 파일을 받지 못했습니다.";
                    return false;
                }
                using (WebClient wc = new WebClient())
                {
                    wc.Headers.Add("User-Agent", "SafeNexDesktop/" + AppConstants.APP_VERSION);
                    wc.DownloadFile(downloadUrl, tempZip);
                }
                return StageOtaFromZipFile(newVersion, tempZip, out errorMsg);
            }
            catch
            {
                errorMsg = "업데이트 파일을 받지 못했습니다.";
                return false;
            }
            finally
            {
                try { if (File.Exists(tempZip)) File.Delete(tempZip); } catch { }
            }
        }

        private bool StageOtaFromStream(string newVersion, Stream body, out string errorMsg)
        {
            errorMsg = null;
            string tempZip = Path.Combine(Path.GetTempPath(), "safenex_ota_" + Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                using (FileStream fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write))
                {
                    byte[] buf = new byte[81920];
                    int read;
                    long total = 0;
                    while ((read = body.Read(buf, 0, buf.Length)) > 0)
                    {
                        total += read;
                        if (total > 50L * 1024 * 1024)
                        {
                            errorMsg = "업데이트 파일을 받지 못했습니다.";
                            return false;
                        }
                        fs.Write(buf, 0, read);
                    }
                }
                return StageOtaFromZipFile(newVersion, tempZip, out errorMsg);
            }
            catch
            {
                errorMsg = "업데이트 파일을 받지 못했습니다.";
                return false;
            }
            finally
            {
                try { if (File.Exists(tempZip)) File.Delete(tempZip); } catch { }
            }
        }

        private void WriteJson(HttpListenerContext ctx, int status, string json)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(json);
            ctx.Response.ContentType = "application/json; charset=utf-8";
            ctx.Response.StatusCode = status;
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            ctx.Response.OutputStream.Close();
        }

        private void ScheduleRestart()
        {
            string exe = _exePath.Replace("\"", "");
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c ping 127.0.0.1 -n 3 >nul & start \"\" \"" + exe + "\"",
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden
            });
            ExitApplication();
        }

        private static void CopyDirectoryRecursive(string sourceDir, string targetDir)
        {
            Directory.CreateDirectory(targetDir);
            foreach (string file in Directory.GetFiles(sourceDir))
            {
                string destFile = Path.Combine(targetDir, Path.GetFileName(file));
                File.Copy(file, destFile, true);
            }
            foreach (string subDir in Directory.GetDirectories(sourceDir))
            {
                string destSubDir = Path.Combine(targetDir, Path.GetFileName(subDir));
                CopyDirectoryRecursive(subDir, destSubDir);
            }
        }

        private ContextMenuStrip BuildContextMenu()
        {
            ContextMenuStrip menu = new ContextMenuStrip();

            ToolStripMenuItem openMainItem = new ToolStripMenuItem("💬 SafeNex PC 메신저 열기");
            openMainItem.Font = new Font(menu.Font, FontStyle.Bold);
            openMainItem.Click += (s, e) => OpenWorkspace("/app/admin/desktop-workspace", AppConstants.MESSENGER_WIDTH, AppConstants.MESSENGER_HEIGHT);
            menu.Items.Add(openMainItem);

            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem dashboardItem = new ToolStripMenuItem("📊 대시보드 열기");
            dashboardItem.Click += (s, e) => OpenWorkspace("/app/admin", AppConstants.WORK_WIDTH, AppConstants.WORK_HEIGHT);
            menu.Items.Add(dashboardItem);

            ToolStripMenuItem approvalsItem = new ToolStripMenuItem("✅ 전자결재 열기");
            approvalsItem.Click += (s, e) => OpenWorkspace("/app/admin/approvals", AppConstants.WORK_WIDTH, AppConstants.WORK_HEIGHT);
            menu.Items.Add(approvalsItem);

            ToolStripMenuItem permitsItem = new ToolStripMenuItem("📝 작업허가서 열기");
            permitsItem.Click += (s, e) => OpenWorkspace("/app/admin/work-permits", AppConstants.WORK_WIDTH, AppConstants.WORK_HEIGHT);
            menu.Items.Add(permitsItem);

            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem webSiteItem = new ToolStripMenuItem("🌐 SafeNex 웹사이트 바로가기 (safenex.org)");
            webSiteItem.Click += (s, e) => OpenExternalBrowser(AppConstants.PUBLIC_SITE_URL);
            menu.Items.Add(webSiteItem);

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

        private void OpenWorkspace(string route, int width, int height)
        {
            string url = "http://127.0.0.1:" + _port + route;
            string sep = url.Contains("?") ? "&" : "?";
            url += sep + "pcboot=" + DateTime.UtcNow.Ticks;
            Program.LaunchAppWindow(url, width, height);
        }

        private static void OpenExternalBrowser(string targetUrl)
        {
            try
            {
                string url = string.IsNullOrEmpty(targetUrl) ? AppConstants.PUBLIC_SITE_URL : targetUrl.Trim();
                if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
                    !url.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                {
                    url = AppConstants.PUBLIC_SITE_URL;
                }
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch { }
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
                ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                ctx.Response.Headers.Add("Access-Control-Allow-Headers", "*");
                ctx.Response.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate");
                ctx.Response.Headers.Add("Pragma", "no-cache");

                if (string.Equals(ctx.Request.HttpMethod, "OPTIONS", StringComparison.OrdinalIgnoreCase))
                {
                    ctx.Response.StatusCode = 204;
                    ctx.Response.Close();
                    return;
                }

                string rawPath = ctx.Request.Url.AbsolutePath;

                // Native window resize endpoint called when switching between Messenger (420x680) and Work Mode (1260x820)
                if (string.Equals(rawPath, "/__desktop/resize", StringComparison.OrdinalIgnoreCase))
                {
                    int w = AppConstants.MESSENGER_WIDTH;
                    int h = AppConstants.MESSENGER_HEIGHT;
                    int.TryParse(ctx.Request.QueryString["w"], out w);
                    int.TryParse(ctx.Request.QueryString["h"], out h);
                    Win32WindowHelper.ResizeActiveAppWindow(w, h);

                    byte[] okBytes = Encoding.UTF8.GetBytes("{\"ok\":true}");
                    ctx.Response.ContentType = "application/json; charset=utf-8";
                    ctx.Response.StatusCode = 200;
                    ctx.Response.ContentLength64 = okBytes.Length;
                    ctx.Response.OutputStream.Write(okBytes, 0, okBytes.Length);
                    ctx.Response.OutputStream.Close();
                    return;
                }

                // Open official SafeNex web site in the user's default full browser tab
                if (string.Equals(rawPath, "/__desktop/open-external", StringComparison.OrdinalIgnoreCase))
                {
                    string targetUrl = ctx.Request.QueryString["url"] ?? AppConstants.PUBLIC_SITE_URL;
                    OpenExternalBrowser(targetUrl);

                    byte[] extBytes = Encoding.UTF8.GetBytes("{\"ok\":true}");
                    ctx.Response.ContentType = "application/json; charset=utf-8";
                    ctx.Response.StatusCode = 200;
                    ctx.Response.ContentLength64 = extBytes.Length;
                    ctx.Response.OutputStream.Write(extBytes, 0, extBytes.Length);
                    ctx.Response.OutputStream.Close();
                    return;
                }

                // Version inquiry endpoint for OTA Auto-Updater
                if (string.Equals(rawPath, "/__desktop/version", StringComparison.OrdinalIgnoreCase))
                {
                    string bundleVer = GetCurrentBundleVersion().Replace("\"", "");
                    string json = "{\"ok\":true,\"appVersion\":\"" + AppConstants.APP_VERSION + "\",\"bundleVersion\":\"" + bundleVer + "\"}";
                    byte[] verBytes = Encoding.UTF8.GetBytes(json);
                    ctx.Response.ContentType = "application/json; charset=utf-8";
                    ctx.Response.StatusCode = 200;
                    ctx.Response.ContentLength64 = verBytes.Length;
                    ctx.Response.OutputStream.Write(verBytes, 0, verBytes.Length);
                    ctx.Response.OutputStream.Close();
                    return;
                }

                if (string.Equals(rawPath, "/__desktop/restart", StringComparison.OrdinalIgnoreCase))
                {
                    WriteJson(ctx, 200, "{\"ok\":true}");
                    ScheduleRestart();
                    return;
                }

                // Browser-downloaded zip. Stored until the next program start, then swapped before the window opens.
                if (string.Equals(rawPath, "/__desktop/stage-ota", StringComparison.OrdinalIgnoreCase))
                {
                    string newVer = RawQueryValue(ctx.Request, "version");
                    string err;
                    bool ok = StageOtaFromStream(newVer, ctx.Request.InputStream, out err);
                    string safeErr = (err ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
                    string safeVer = (newVer ?? "").Replace("\"", "");
                    string respJson = ok
                        ? "{\"ok\":true,\"pending\":true,\"version\":\"" + safeVer + "\"}"
                        : "{\"ok\":false,\"error\":\"" + safeErr + "\"}";
                    WriteJson(ctx, 200, respJson);
                    return;
                }

                // Older screen builds still ask the program to download. Stage that zip too.
                if (string.Equals(rawPath, "/__desktop/apply-ota", StringComparison.OrdinalIgnoreCase))
                {
                    string newVer = RawQueryValue(ctx.Request, "version");
                    string downloadUrl = RawQueryValue(ctx.Request, "url");
                    string err;
                    bool ok = false;
                    if (!string.IsNullOrEmpty(newVer) && !string.IsNullOrEmpty(downloadUrl))
                        ok = StageOtaFromDownload(newVer, downloadUrl, out err);
                    else
                        err = "업데이트 버전을 확인하지 못했습니다.";

                    string safeErr = (err ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
                    string safeVer = (newVer ?? "").Replace("\"", "");
                    string respJson = ok
                        ? "{\"ok\":true,\"pending\":true,\"version\":\"" + safeVer + "\"}"
                        : "{\"ok\":false,\"error\":\"" + safeErr + "\"}";
                    WriteJson(ctx, 200, respJson);
                    return;
                }

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
                    string html = File.ReadAllText(filePath, Encoding.UTF8);
                    string curBundleVer = GetCurrentBundleVersion().Replace("'", "");
                    string bridgeScript = "<script>window.safenexDesktop={isDesktopApp:true,platform:'win32',appVersion:'" + curBundleVer + "'};try{localStorage.setItem('forceDesktopUI','1');sessionStorage.setItem('safenex_pc_shell','1');}catch(e){}</script>";
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
