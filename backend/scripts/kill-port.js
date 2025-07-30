// backend/scripts/kill-port.js
const { exec } = require('child_process');
const os = require('os');

const port = process.argv[2] || process.env.PORT || 3005;

function killPort(port) {
    const platform = os.platform();
    let command;

    if (platform === 'win32') {
        // Windows
        command = `netstat -ano | findstr :${port} | findstr LISTENING`;
        exec(command, (error, stdout) => {
            if (stdout) {
                const lines = stdout.trim().split('\n');
                lines.forEach(line => {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && pid !== '0') {
                        console.log(`Killing process ${pid} on port ${port}...`);
                        exec(`cmd /c taskkill /PID ${pid} /F`, (killError) => {
                            if (killError) {
                                console.error(`Failed to kill process ${pid}:`, killError.message);
                            } else {
                                console.log(`Successfully killed process ${pid}`);
                            }
                        });
                    }
                });
            } else {
                console.log(`No process found on port ${port}`);
            }
        });
    } else {
        // Unix-based systems (Linux, macOS)
        command = `lsof -ti:${port}`;
        exec(command, (error, stdout) => {
            if (stdout) {
                const pids = stdout.trim().split('\n');
                pids.forEach(pid => {
                    if (pid) {
                        console.log(`Killing process ${pid} on port ${port}...`);
                        exec(`kill -9 ${pid}`, (killError) => {
                            if (killError) {
                                console.error(`Failed to kill process ${pid}:`, killError.message);
                            } else {
                                console.log(`Successfully killed process ${pid}`);
                            }
                        });
                    }
                });
            } else {
                console.log(`No process found on port ${port}`);
            }
        });
    }
}

console.log(`Checking port ${port}...`);
killPort(port);