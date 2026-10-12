using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace ItzCutInstaller
{
    public class InstallerForm : Form
    {
        private Label titleLabel;
        private Label subtitleLabel;
        private Label statusLabel;
        private Label speedLabel;
        private ProgressBar progressBar;
        private Button cancelButton;
        private WebClient client;
        private string tempFile;
        private DateTime lastTime;
        private long lastBytes;

        [STAThread]
        public static void Main()
        {
            try
            {
                // Force TLS 1.2 and modern TLS for GitHub connectivity
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)12288 | SecurityProtocolType.Tls;
            }
            catch { }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }

        public InstallerForm()
        {
            this.Text = "itzCut Desktop — Web Installer";
            this.Size = new Size(500, 250);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = true;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(8, 11, 16); // #080b10
            this.ForeColor = Color.FromArgb(240, 246, 252);

            // Title
            titleLabel = new Label();
            titleLabel.Text = "itzCut Desktop";
            titleLabel.Font = new Font("Segoe UI", 16, FontStyle.Bold);
            titleLabel.ForeColor = Color.FromArgb(230, 180, 34); // Gold #e6b422
            titleLabel.Location = new Point(24, 20);
            titleLabel.AutoSize = true;
            this.Controls.Add(titleLabel);

            // Subtitle
            subtitleLabel = new Label();
            subtitleLabel.Text = "High-Performance Local Video Renderer & Trimmer";
            subtitleLabel.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            subtitleLabel.ForeColor = Color.FromArgb(139, 148, 158);
            subtitleLabel.Location = new Point(26, 52);
            subtitleLabel.AutoSize = true;
            this.Controls.Add(subtitleLabel);

            // Status
            statusLabel = new Label();
            statusLabel.Text = "Connecting to official release server...";
            statusLabel.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            statusLabel.ForeColor = Color.FromArgb(201, 209, 217);
            statusLabel.Location = new Point(26, 95);
            statusLabel.Size = new Size(440, 20);
            this.Controls.Add(statusLabel);

            // Progress Bar
            progressBar = new ProgressBar();
            progressBar.Location = new Point(26, 120);
            progressBar.Size = new Size(440, 22);
            progressBar.Style = ProgressBarStyle.Continuous;
            this.Controls.Add(progressBar);

            // Speed & Details Label
            speedLabel = new Label();
            speedLabel.Text = "Initializing...";
            speedLabel.Font = new Font("Consolas", 8.5f, FontStyle.Regular);
            speedLabel.ForeColor = Color.FromArgb(139, 148, 158);
            speedLabel.Location = new Point(26, 152);
            speedLabel.Size = new Size(330, 20);
            this.Controls.Add(speedLabel);

            // Cancel Button
            cancelButton = new Button();
            cancelButton.Text = "Cancel";
            cancelButton.Font = new Font("Segoe UI", 9f);
            cancelButton.Size = new Size(95, 30);
            cancelButton.Location = new Point(371, 158);
            cancelButton.BackColor = Color.FromArgb(22, 27, 34);
            cancelButton.ForeColor = Color.White;
            cancelButton.FlatStyle = FlatStyle.Flat;
            cancelButton.FlatAppearance.BorderColor = Color.FromArgb(48, 54, 61);
            cancelButton.Click += (s, e) => {
                if (client != null && client.IsBusy) client.CancelAsync();
                this.Close();
            };
            this.Controls.Add(cancelButton);

            this.Shown += (s, e) => StartInstallProcess();
        }

        private void StartInstallProcess()
        {
            Thread worker = new Thread(() =>
            {
                try
                {
                    UpdateStatus("Checking latest itzCut Desktop release...", "GitHub API");
                    string downloadUrl = ResolveDownloadUrl();

                    if (string.IsNullOrEmpty(downloadUrl))
                    {
                        downloadUrl = "https://github.com/itzCrih/itzCut-Windows/releases/download/v2.0.0/itzCut-Desktop-Setup-2.0.0.exe";
                    }

                    tempFile = Path.Combine(Path.GetTempPath(), "itzCut-Desktop-Setup-Latest.exe");

                    this.Invoke(new Action(() =>
                    {
                        statusLabel.Text = "Downloading official setup package...";
                        DownloadFile(downloadUrl, tempFile);
                    }));
                }
                catch (Exception ex)
                {
                    this.Invoke(new Action(() =>
                    {
                        MessageBox.Show(
                            "Failed to connect to the update server: " + ex.Message + "\n\nPlease check your internet connection.",
                            "itzCut Setup Error",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error
                        );
                        this.Close();
                    }));
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private string ResolveDownloadUrl()
        {
            try
            {
                using (var wc = new WebClient())
                {
                    wc.Headers.Add("User-Agent", "itzCut-WebInstaller");
                    string json = wc.DownloadString("https://api.github.com/repos/itzCrih/itzCut-Windows/releases/latest");

                    // Search for setup .exe download url in assets
                    Match match = Regex.Match(json, "\"browser_download_url\":\\s*\"(https://[^\"]+Setup[^\"]+\\.exe)\"", RegexOptions.IgnoreCase);
                    if (match.Success)
                    {
                        return match.Groups[1].Value;
                    }

                    // Fallback to any .exe in assets
                    match = Regex.Match(json, "\"browser_download_url\":\\s*\"(https://[^\"]+\\.exe)\"", RegexOptions.IgnoreCase);
                    if (match.Success)
                    {
                        return match.Groups[1].Value;
                    }
                }
            }
            catch { }

            return null;
        }

        private void DownloadFile(string url, string destination)
        {
            client = new WebClient();
            client.Headers.Add("User-Agent", "itzCut-WebInstaller");

            lastTime = DateTime.Now;
            lastBytes = 0;

            client.DownloadProgressChanged += (s, e) =>
            {
                progressBar.Value = Math.Min(100, Math.Max(0, e.ProgressPercentage));

                double elapsed = (DateTime.Now - lastTime).TotalSeconds;
                if (elapsed >= 0.5)
                {
                    long bytesDiff = e.BytesReceived - lastBytes;
                    double speedMB = (bytesDiff / elapsed) / (1024.0 * 1024.0);

                    double receivedMB = e.BytesReceived / (1024.0 * 1024.0);
                    double totalMB = e.TotalBytesToReceive / (1024.0 * 1024.0);

                    speedLabel.Text = string.Format("{0:0.0} MB / {1:0.0} MB ({2:0.0} MB/s)", receivedMB, totalMB, speedMB);

                    lastTime = DateTime.Now;
                    lastBytes = e.BytesReceived;
                }
            };

            client.DownloadFileCompleted += (s, e) =>
            {
                if (e.Cancelled)
                {
                    CleanupTemp();
                    return;
                }

                if (e.Error != null)
                {
                    MessageBox.Show("Download failed: " + e.Error.Message, "itzCut Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    CleanupTemp();
                    this.Close();
                    return;
                }

                try
                {
                    statusLabel.Text = "Download complete! Launching installer...";
                    progressBar.Value = 100;
                    speedLabel.Text = "Starting setup...";

                    // Launch setup installer
                    ProcessStartInfo psi = new ProcessStartInfo(destination);
                    psi.UseShellExecute = true;
                    Process.Start(psi);

                    // Wait a second and exit
                    Thread.Sleep(1200);
                    this.Close();
                }
                catch (Exception ex)
                {
                    MessageBox.Show("Could not launch installer: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    this.Close();
                }
            };

            client.DownloadFileAsync(new Uri(url), destination);
        }

        private void UpdateStatus(string text, string speedText)
        {
            if (this.IsHandleCreated)
            {
                this.Invoke(new Action(() =>
                {
                    statusLabel.Text = text;
                    speedLabel.Text = speedText;
                }));
            }
        }

        private void CleanupTemp()
        {
            try
            {
                if (!string.IsNullOrEmpty(tempFile) && File.Exists(tempFile))
                {
                    File.Delete(tempFile);
                }
            }
            catch { }
        }
    }
}
