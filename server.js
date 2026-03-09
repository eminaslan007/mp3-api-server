const express = require('express');
const cors = require('cors');
const yts = require('yt-search');
const https = require('https');
const http = require('http');

const app = express();
app.use(cors());

// RapidAPI Configuration
const RAPIDAPI_KEY = '0173422365mshf1348595d1df17fp1ad41djsnfe6b2c8edbdd';
const RAPIDAPI_HOST = 'yt-api.p.rapidapi.com';

// Fetch JSON with native fetch
async function fetchJSON(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            ...options,
            signal: controller.signal,
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

// Get audio URL via RapidAPI
async function getAudioUrl(videoId) {
    try {
        console.log(`📡 Fetching stream for ${videoId} via RapidAPI...`);
        const data = await fetchJSON(`https://${RAPIDAPI_HOST}/dl?id=${videoId}`, {
            headers: {
                'x-rapidapi-key': RAPIDAPI_KEY,
                'x-rapidapi-host': RAPIDAPI_HOST
            }
        });

        if (data && data.adaptiveFormats && data.adaptiveFormats.length > 0) {
            // Filter audio formats
            const audioFormats = data.adaptiveFormats.filter(f => f.mimeType && f.mimeType.startsWith('audio/'));

            // Sort by bitrate descending
            audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

            if (audioFormats.length > 0) {
                console.log(`✅ Audio found via RapidAPI (${audioFormats[0].bitrate}bps)`);
                return audioFormats[0].url;
            }
        }

        throw new Error('No audio formats found in RapidAPI response');
    } catch (err) {
        console.log(`⚠️ RapidAPI failed: ${err.message}`);
        throw err;
    }
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
    console.log(`📡 Using RapidAPI configured stream engine`);
});
