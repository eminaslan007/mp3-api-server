const express = require('express');
const cors = require('cors');
const yts = require('yt-search');
const { exec } = require('child_process');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
app.use(cors());

// yt-dlp binary path (Linux binary downloaded during build)
const YTDLP_PATH = path.join(__dirname, 'yt-dlp');

// Helper: run yt-dlp to get audio URL
function getAudioUrl(videoId) {
    return new Promise((resolve, reject) => {
        const cmd = `"${YTDLP_PATH}" -f "ba[ext=m4a]/ba" --get-url --no-warnings --no-check-certificates "https://www.youtube.com/watch?v=${videoId}"`;
        exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
                return;
            }
            const url = stdout.trim();
            if (!url || !url.startsWith('http')) {
                reject(new Error('Could not extract audio URL'));
                return;
            }
            resolve(url);
        });
    });
}

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'MP3 API Server' });
});

// Arama Endpoint
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: 'Query parameter is required' });

        const r = await yts(query);
        const videos = r.videos.slice(0, 25).map(v => ({
            id: v.videoId,
            title: v.title,
            thumbnail: v.image,
            duration: v.seconds,
            author: v.author.name,
            views: v.views
        }));

        res.json(videos);
    } catch (error) {
        console.error('Search Error:', error);
        res.status(500).json({ error: 'Failed to fetch search results' });
    }
});

// Trendler Endpoint
app.get('/trending', async (req, res) => {
    try {
        const r = await yts('en çok dinlenen popüler türkçe müzikler 2024');
        const videos = r.videos.slice(0, 20).map(v => ({
            id: v.videoId,
            title: v.title,
            thumbnail: v.image,
            duration: v.seconds,
            author: v.author.name,
            views: v.views
        }));

        res.json(videos);
    } catch (error) {
        console.error('Trending Error:', error);
        res.status(500).json({ error: 'Failed to fetch trending results' });
    }
});

// Stream — returns direct YouTube audio URL
app.get('/stream/:videoId', async (req, res) => {
    try {
        const videoId = req.params.videoId;
        if (!videoId) return res.status(400).json({ error: 'Video ID is required' });

        const audioUrl = await getAudioUrl(videoId);
        const info = await yts({ videoId });

        res.json({
            url: audioUrl,
            title: info.title || 'Bilinmiyor',
            author: info.author?.name || 'Bilinmiyor',
            duration: info.seconds || 0,
            thumbnailUrl: info.image || ''
        });
    } catch (error) {
        console.error('Stream Error:', error.message);
        res.status(500).json({ error: 'Failed to get stream info', message: error.message });
    }
});

// Download proxy (fallback)
app.get('/download/:videoId', async (req, res) => {
    try {
        const videoId = req.params.videoId;
        const title = req.query.title || videoId;

        const audioUrl = await getAudioUrl(videoId);

        const safeTitle = String(title).replace(/[^a-zA-Z0-9\s\-_]/g, '').substring(0, 80) || videoId;
        res.setHeader('Content-Type', 'audio/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.m4a"`);

        const protocol = audioUrl.startsWith('https') ? https : http;
        protocol.get(audioUrl, (audioStream) => {
            if (audioStream.headers['content-length']) {
                res.setHeader('Content-Length', audioStream.headers['content-length']);
            }
            audioStream.pipe(res);
            audioStream.on('error', (err) => {
                if (!res.headersSent) res.status(500).json({ error: 'Stream failed' });
            });
        }).on('error', (err) => {
            if (!res.headersSent) res.status(500).json({ error: 'Failed to fetch audio' });
        });
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: 'Download failed', message: error.message });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 MP3 API Server running on port ${PORT}`);
    exec(`"${YTDLP_PATH}" --version`, (err, stdout) => {
        if (err) {
            console.log('⚠️  yt-dlp not found!');
        } else {
            console.log(`✅ yt-dlp version: ${stdout.trim()}`);
        }
    });
});
