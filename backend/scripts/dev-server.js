// backend/scripts/dev-server.js
const { spawn } = require('child_process');
const path = require('path');

const port = process.env.PORT || 3005;

console.log(`Starting development server on port ${port}...`);

// First, try to kill any process on the port
const killPortScript = path.join(__dirname, 'kill-port.js');
const killProcess = spawn('node', [`"${killPortScript}"`, port], {
    stdio: 'inherit',
    shell: true
});

killProcess.on('close', (code) => {
    // Wait a moment for the port to be fully released
    setTimeout(() => {
        console.log('\nStarting nodemon...');
        
        // Start nodemon
        const nodemon = spawn('npx', ['nodemon', 'src/server.js'], {
            stdio: 'inherit',
            shell: true,
            cwd: path.join(__dirname, '..')
        });

        nodemon.on('error', (error) => {
            console.error('Failed to start nodemon:', error);
            process.exit(1);
        });

        // Handle process termination
        process.on('SIGINT', () => {
            nodemon.kill('SIGINT');
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            nodemon.kill('SIGTERM');
            process.exit(0);
        });
    }, 1000);
});