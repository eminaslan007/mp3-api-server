const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
const YTDLP_PATH = './yt-dlp';

if (fs.existsSync(YTDLP_PATH)) {
    console.log('yt-dlp already exists, skipping download.');
    process.exit(0);
}

console.log('Downloading yt-dlp...');

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                download(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', reject);
    });
}

download(YTDLP_URL, YTDLP_PATH)
    .then(() => {
        fs.chmodSync(YTDLP_PATH, '755');
        console.log('yt-dlp downloaded and ready!');
    })
    .catch((err) => {
        console.error('Failed to download yt-dlp:', err);
        process.exit(1);
    });
