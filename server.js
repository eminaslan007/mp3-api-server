const express = require('express');
const cors = require('cors');
const yts = require('yt-search');
const https = require('https');
const http = require('http');

const app = express();
app.use(cors());

// List of Piped API instances (fallback chain)
const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://pipedapi.r4fo.com',
    'https://pipedapi.moomoo.me',
];

// Fetch with timeout
function fetchJSON(url, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
        const protocol = url.startsWith('https') ? https : http;

        protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                clearTimeout(timer);
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid JSON'));
                }
            });
        }).on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

// Get audio URL from Piped instances (try each until one works)
async function getAudioUrl(videoId) {
    let lastError = null;

    for (const instance of PIPED_INSTANCES) {
        try {
            const data = await fetchJSON(`${instance}/streams/${videoId}`);

            if (data.audioStreams && data.audioStreams.length > 0) {
                // Sort by bitrate descending, pick best audio
                const sorted = data.audioStreams
                    .filter(s => s.mimeType && s.mimeType.includes('audio'))
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                if (sorted.length > 0) {
                    console.log(`✅ Audio found via ${instance} (${sorted[0].bitrate}bps)`);
                    return sorted[0].url;
                }
            }
            lastError = new Error('No audio streams in response');
        } catch (err) {
            lastError = err;
            console.log(`⚠️ ${instance} failed: ${err.message}`);
        }
    }

    throw lastError || new Error('All Piped instances failed');
}

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'MP3 API Server (Piped)' });
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

// Stream — returns direct audio URL via Piped
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
    console.log(`📡 Using Piped instances: ${PIPED_INSTANCES.length} configured`);
});
