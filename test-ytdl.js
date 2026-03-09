const ytdl = require('@distube/ytdl-core');

async function test() {
    try {
        const url = `https://www.youtube.com/watch?v=cLygvXtuklI`;
        const info = await ytdl.getInfo(url);
        let format = ytdl.chooseFormat(info.formats, { filter: 'audioonly', quality: 'highestaudio' });
        console.log(format.url.substring(0, 100));
    } catch (err) {
        console.error("error", err);
    }
}
test();
