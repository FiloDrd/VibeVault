import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import sharp from 'sharp'

/** Genera una piccola libreria campione realistica (foto con EXIF/GPS, PNG, GIF animata, video, corrotti, duplicati). */
export async function makeSampleLibrary(root: string): Promise<void> {
  const lib = path.join(root, 'Library')
  const w = (rel: string) => { const p = path.join(lib, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); return p }

  const colors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#1a535c', '#ff9f1c', '#6a4c93']
  for (let i = 0; i < 6; i++) {
    await sharp({ create: { width: 1200, height: 800, channels: 3, background: colors[i] } })
      .jpeg({ quality: 80 })
      .withExif({
        IFD0: { Make: 'Canon', Model: 'EOS R6', DateTime: `2023:0${i + 1}:15 10:30:00` },
        IFD2: { DateTimeOriginal: `2023:0${i + 1}:15 10:30:00` },
        ...(i === 0 ? { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 27/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '9/1 11/1 0/1' } } : {})
      })
      .toFile(w(`Foto/2023/IMG_000${i}.jpg`))
  }
  // Foto verticale senza EXIF
  await sharp({ create: { width: 600, height: 1000, channels: 3, background: '#3a86ff' } }).png().toFile(w('Foto/verticale.png'))
  // Screenshot
  await sharp({ create: { width: 1920, height: 1080, channels: 4, background: '#222222' } }).png().toFile(w('Screenshots/Screenshot 2024-02-01 101010.png'))
  // WebP
  await sharp({ create: { width: 800, height: 800, channels: 3, background: '#8338ec' } }).webp().toFile(w('Foto/quadrata.webp'))
  // Duplicato esatto
  fs.copyFileSync(w('Foto/2023/IMG_0001.jpg'), w('Foto/Copia di IMG_0001.jpg'))
  // GIF animata (3 frame)
  const frames = await Promise.all(['#ff0000', '#00ff00', '#0000ff'].map((c) => sharp({ create: { width: 120, height: 80, channels: 3, background: c } }).raw().toBuffer()))
  await sharp(Buffer.concat(frames), { raw: { width: 120, height: 240, channels: 3 } })
    .gif({ delay: [200, 200, 200], loop: 0 })
    .toFile(w('GIF/animata.gif'))
    .catch(async () => {
      await sharp({ create: { width: 120, height: 80, channels: 3, background: '#ff0000' } }).gif().toFile(w('GIF/animata.gif'))
    })
  // Video (se FFmpeg è disponibile)
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-t', '3', '-pix_fmt', 'yuv420p', '-metadata', 'creation_time=2022-08-10T12:00:00Z', w('Video/orizzontale.mp4')])
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=240x426:rate=25', '-t', '2', '-pix_fmt', 'yuv420p', w('Video/verticale.mp4')])
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-t', '2', '-c:v', 'libvpx', w('Video/clip.webm')])
  } catch {
    /* ffmpeg assente: i test video vengono saltati */
  }
  // Corrotti / vuoti / non media
  fs.writeFileSync(w('Foto/rotto.jpg'), Buffer.from('non è davvero un jpeg'))
  fs.writeFileSync(w('Foto/vuoto.png'), Buffer.alloc(0))
  fs.writeFileSync(w('Video/rotto.mp4'), Buffer.from('garbage'.repeat(100)))
  fs.writeFileSync(w('note.txt'), 'file non multimediale, da ignorare')
  // Cartelle che NON vanno scansionate
  fs.mkdirSync(path.join(lib, '.nascosta'), { recursive: true })
  fs.copyFileSync(w('Foto/verticale.png'), path.join(lib, '.nascosta', 'segreto.png'))
}
