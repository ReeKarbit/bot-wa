const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Buat temp directory jika belum ada
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

// Setup express server untuk Railway
app.get('/', (req, res) => {
    res.send('Bot WhatsApp Aktif! 🤖');
});

let qrCode = '';

// Buat client WhatsApp dengan opsi untuk Railway
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: tempDir }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    },
    restartOnAuthFail: true,
    takeoverOnConflict: true,
    takeoverTimeoutMs: 10000
});

// Event saat QR code tersedia
client.on('qr', (qr) => {
    qrCode = qr;
    console.log('\n=== KODE QR WHATSAPP BOT ===\n');
    qrcode.generate(qr, { small: true });
    console.log('\nSilakan scan Kode QR di atas menggunakan WhatsApp di HP anda\n');
});

// Tambah endpoint untuk melihat QR code
app.get('/qr', (req, res) => {
    if (qrCode) {
        res.send(`<pre>${qrCode}</pre>`);
    } else {
        res.send('QR Code belum tersedia atau bot sudah terautentikasi');
    }
});

// Event saat bot siap
client.on('ready', () => {
    console.log('\n=== BOT WHATSAPP AKTIF ===');
    console.log('Bot sudah siap digunakan!');
    console.log('Ketik .menu di WhatsApp untuk melihat daftar perintah\n');
    qrCode = ''; // Reset QR code setelah terautentikasi
});

// Event saat koneksi terputus
client.on('disconnected', async (reason) => {
    console.log('Bot terputus:', reason);
    qrCode = '';
    try {
        console.log('Mencoba menghubungkan kembali...');
        await client.destroy();
        await client.initialize();
    } catch (error) {
        console.error('Gagal menghubungkan kembali:', error);
    }
});

// Event saat ada error autentikasi
client.on('auth_failure', async () => {
    console.error('Gagal autentikasi, mencoba menghubungkan kembali...');
    qrCode = '';
    try {
        await client.destroy();
        setTimeout(async () => {
            await client.initialize();
        }, 5000);
    } catch (error) {
        console.error('Gagal menghubungkan kembali:', error);
    }
});

// Event saat koneksi berubah
client.on('change_state', (state) => {
    console.log('Status koneksi:', state);
});

// Fungsi untuk membuat sticker dari gambar
async function createSticker(msg) {
    try {
        const media = await msg.downloadMedia();
        if (!media) {
            await msg.reply('❌ Gagal mengunduh media. Pastikan gambar terkirim dengan benar.');
            return;
        }

        if (!media.mimetype.startsWith('image/')) {
            await msg.reply('❌ Format tidak didukung. Kirim gambar untuk membuat sticker.');
            return;
        }

        const imageBuffer = Buffer.from(media.data, 'base64');
        
        // Process image with sharp
        const processedImage = await sharp(imageBuffer)
            .resize(512, 512, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .toFormat('webp')
            .webp({ quality: 80 })
            .toBuffer();

        // Convert back to base64
        const base64Image = processedImage.toString('base64');
        const stickerMedia = new MessageMedia('image/webp', base64Image, 'sticker.webp');

        // Send as sticker
        await msg.reply(stickerMedia, null, {
            sendMediaAsSticker: true,
            stickerAuthor: 'Rehan Bot',
            stickerName: 'Sticker',
            stickerCategories: ['🎨']
        });
    } catch (error) {
        console.error('Error creating sticker:', error);
        await msg.reply('❌ Gagal membuat sticker. Silakan coba lagi.');
    }
}

async function createVideoSticker(msg, media) {
    console.log('Starting video sticker creation...');
    console.log('Media type:', media.mimetype);
    try {
        // Ensure temp directory exists
        if (!fs.existsSync(tempDir)) {
            console.log('Creating temp directory...');
            fs.mkdirSync(tempDir);
        }

        // Save video buffer to temporary file
        const videoPath = path.join(tempDir, `video_${Date.now()}.mp4`);
        const outputPath = path.join(tempDir, `sticker_${Date.now()}.webp`);
        fs.writeFileSync(videoPath, Buffer.from(media.data, 'base64'));

        // Convert video to WebP
        return new Promise((resolve, reject) => {
            console.log('Video path:', videoPath);
            console.log('Output path:', outputPath);
            
            const command = ffmpeg()
                .input(videoPath)
                .inputOptions(['-t', '8'])
                .outputOptions([
                    '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
                    '-vcodec', 'libwebp',
                    '-lossless', '1',
                    '-qscale', '1',
                    '-preset', 'default',
                    '-loop', '0',
                    '-an',
                    '-vsync', '0',
                    '-t', '8'
                ])
                .toFormat('webp')
                .on('start', (commandLine) => {
                    console.log('FFmpeg command:', commandLine);
                })
                .on('progress', (progress) => {
                    console.log('Processing: ' + Math.floor(progress.percent) + '% done');
                })
                .on('end', async () => {
                    try {
                        const webpData = fs.readFileSync(outputPath);
                        const base64Data = webpData.toString('base64');
                        
                        // Cleanup temporary files
                        fs.unlinkSync(videoPath);
                        fs.unlinkSync(outputPath);
                        
                        resolve(new MessageMedia('video/webp', base64Data, 'sticker.webp'));
                    } catch (error) {
                        console.error('Error reading output file:', error);
                        reject(error);
                    }
                })
                .on('error', (err) => {
                    console.error('FFmpeg error:', err);
                    // Cleanup temporary files
                    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                    reject(err);
                })
                .save(outputPath);
        });
    } catch (error) {
        console.error('Error creating video sticker:', error);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            path: error.path,
            syscall: error.syscall
        });
        throw error;
    }
}

async function createSticker(msg) {
    try {
        const media = await msg.downloadMedia();
        if (!media) {
            await msg.reply('❌ Gagal mengunduh media. Pastikan media terkirim dengan benar.');
            return;
        }

        let stickerMedia;
        if (media.mimetype.startsWith('image/')) {
            stickerMedia = await createImageSticker(msg, media);
        } else {
            await msg.reply('❌ Format tidak didukung. Kirim gambar saja untuk membuat sticker.');
            return;
        }

        // Send as sticker
        await msg.reply(stickerMedia, null, {
            sendMediaAsSticker: true,
            stickerAuthor: 'Rehan Bot',
            stickerName: 'Sticker',
            stickerCategories: ['🎨']
        });
    } catch (error) {
        console.error('Error creating sticker:', error);
        await msg.reply('❌ Gagal membuat sticker. Silakan coba lagi.');
    }
}

// Function to convert MP4 to GIF
async function convertToGif(msg, media) {
    try {
        const inputPath = path.join(tempDir, `input-${Date.now()}.mp4`);
        const outputPath = path.join(tempDir, `output-${Date.now()}.mp4`);

        // Save the media to temp directory
        fs.writeFileSync(inputPath, media.data, 'base64');

        // Convert MP4 to GIF-like MP4 (short, looped video)
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .outputOptions([
                    '-vf', 'scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
                    '-loop', '0',
                    '-preset', 'fast',
                    '-an',
                    '-t', '5',
                    '-movflags', '+faststart',
                    '-pix_fmt', 'yuv420p'
                ])
                .toFormat('mp4')
                .save(outputPath)
                .on('end', () => resolve())
                .on('error', (err) => reject(err));
        });

        // Read the converted video
        const video = fs.readFileSync(outputPath);
        const videoMedia = new MessageMedia('video/mp4', video.toString('base64'), 'animation.mp4');

        // Send the video as animated message
        await msg.reply(videoMedia, null, { sendVideoAsGif: true });
        await msg.reply('✅ Video berhasil dikonversi menjadi animasi!');

        // Clean up temp files
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);

    } catch (error) {
        console.error('Error converting to GIF:', error);
        await msg.reply('❌ Maaf, terjadi kesalahan saat mengkonversi video.');
    }
}

// Function to convert GIF to Sticker
async function gifToSticker(msg, media) {
    try {
        const inputPath = path.join(tempDir, `input-${Date.now()}.gif`);
        const outputPath = path.join(tempDir, `output-${Date.now()}.webp`);

        // Save the media to temp directory
        fs.writeFileSync(inputPath, media.data, 'base64');

        // Convert GIF to WebP using FFmpeg
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .toFormat('webp')
                .addOutputOptions([
                    '-vf', 'scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:-1:-1:color=#00000000',
                    '-loop', '0',
                    '-compression_level', '6'
                ])
                .on('end', () => resolve())
                .on('error', (err) => reject(err))
                .save(outputPath);
        });

        // Read the converted WebP
        const sticker = fs.readFileSync(outputPath);
        const stickerMedia = new MessageMedia('image/webp', sticker.toString('base64'), 'sticker.webp');

        // Send the sticker
        await msg.reply(stickerMedia);

        // Clean up temp files
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);

    } catch (error) {
        console.error('Error converting GIF to sticker:', error);
        await msg.reply('Maaf, terjadi kesalahan saat mengkonversi GIF ke sticker.');
    }
}

// Event saat menerima pesan
client.on('message', async msg => {
    const text = msg.body.toLowerCase();
    
    switch(text) {
        case '.menu':
        case '.help':
            await msg.reply(
                '🤖 *MENU BOT* 🤖\n\n' +
                '*1.* .sticker - Membuat sticker dari gambar\n' +
                '*2.* .ping - Cek bot aktif\n' +
                '*3.* .info - Informasi bot\n' +
                '*4.* .owner - Info pembuat bot\n\n' +
                '📝 *Cara Penggunaan:*\n' +
                '• Kirim gambar dengan caption .sticker'
            );
            break;

        case '.ping':
            await msg.reply('Pong! 🏓\nBot aktif dan siap digunakan!');
            break;

        case '.info':
            await msg.reply(
                '🤖 *INFO BOT* 🤖\n\n' +
                '• Nama: WhatsApp Bot\n' +
                '• Versi: 1.0.0\n' +
                '• Bahasa: JavaScript\n' +
                '• Library: whatsapp-web.js\n' +
                '• Runtime: Node.js\n' +
                '• Platform: Node.js\n' +
                '• Database: -\n' +
                '• Prefix: .\n' +
                '• Fitur: Sticker Maker'
            );
            break;

        case '.owner':
            await msg.reply(
                '👨‍💻 *OWNER BOT* 👨‍💻\n\n' +
                '• Nama: Rehan\n' +
                '• Status: Active\n' +
                '• Instagram: @rehan\n' +
                '• Motto: Hidup itu seperti di perkosa, kalau tidak bisa melawan cobalah untuk dinikmati'
            );
            break;

        case '.sticker':
            try {
                let targetMsg = msg;
                
                // Check if it's a reply to a message with media
                if (msg.hasQuotedMsg) {
                    const quotedMsg = await msg.getQuotedMessage();
                    if (quotedMsg.hasMedia) {
                        targetMsg = quotedMsg;
                    }
                }
                
                // Check if we have media to process
                if (!targetMsg.hasMedia) {
                    await msg.reply('❌ Kirim gambar dengan caption .sticker atau reply pesan dengan gambar menggunakan .sticker');
                    return;
                }
                
                await msg.reply('⏳ Sedang membuat sticker...');
                await createSticker(targetMsg);
            } catch (error) {
                console.error('Error in sticker command:', error);
                await msg.reply('❌ Terjadi kesalahan saat membuat sticker. Silakan coba lagi.');
            }
            break;
    }
});

// Jalankan server express
app.listen(port, () => {
    console.log(`Server berjalan di port ${port}`);
});

// Mulai bot
client.initialize().catch((err) => {
    console.error('Terjadi kesalahan saat menginisialisasi bot:', err);
    setTimeout(async () => {
        try {
            await client.destroy();
            console.log('Mencoba menghubungkan kembali...');
            await client.initialize();
        } catch (error) {
            console.error('Gagal menghubungkan kembali:', error);
        }
    }, 5000);
});
