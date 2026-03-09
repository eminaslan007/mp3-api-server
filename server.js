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
    'https://pipedapi.leptons.xyz',
    'https://pipedapi.in.projectsegfau.lt',
    'https://api.piped.yt',
    'https://pipedapi.drgns.space',
];

// Fetch JSON with native fetch (Node 18+, handles redirects)
async function fetchJSON(url, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        clearTimeout(timer);

        const text = await res.text();
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
        }
        return JSON.parse(text);
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
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

// YouTube Türkiye Top 50 Endpoint
app.get('/top50', async (req, res) => {
    try {
        const playlistId = 'PL4fGSI1pDJn6rnJKpaAkK1XK8QUfa9KqP';
        const r = await yts({ listId: playlistId });

        if (!r || !r.videos || r.videos.length === 0) {
            return res.status(500).json({ error: 'Playlist boş veya bulunamadı' });
        }

        const videos = r.videos.slice(0, 50).map((v, i) => ({
            id: v.videoId,
            title: v.title,
            thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            duration: v.duration ? v.duration.seconds : (v.seconds || 0),
            author: v.author ? (v.author.name || v.author) : 'Bilinmiyor',
            views: v.views || 0,
            rank: i + 1,
        }));

        res.json(videos);
    } catch (error) {
        console.error('Top50 Error:', error);
        res.status(500).json({ error: 'Failed to fetch top 50' });
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
