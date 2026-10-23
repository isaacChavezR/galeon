// Genera build/icon.ico y build/icon.png desde assets/logo.svg
// Uso: npx electron scripts/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES_ICO = [16, 32, 48, 64, 128, 256];
const BUILD_DIR = path.join(__dirname, '..', 'build');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Ensambla un .ico con entradas PNG (formato válido desde Windows Vista)
function packIco(pngs) { // pngs: [{size, buf}]
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);           // reservado
  header.writeUInt16LE(1, 2);           // tipo: icono
  header.writeUInt16LE(pngs.length, 4); // número de imágenes
  let offset = 6 + pngs.length * 16;
  const entries = [];
  const blobs = [];
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    const dim = size >= 256 ? 0 : size;   // 256 se codifica como 0
    e.writeUInt8(dim, 0);                 // ancho
    e.writeUInt8(dim, 1);                 // alto
    e.writeUInt8(0, 2);                   // colores de paleta
    e.writeUInt8(0, 3);                   // reservado
    e.writeUInt16LE(1, 4);                // planos
    e.writeUInt16LE(32, 6);               // bits
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    blobs.push(buf);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    // En este entorno, capturePage solo pinta en ventanas visibles:
    // la ventana aparece un instante en pantalla mientras se generan los iconos.
    win = new BrowserWindow({
      width: 256, height: 256, show: true, frame: false, transparent: true,
      useContentSize: true, center: true, focusable: false, skipTaskbar: true, alwaysOnTop: true
    });
    await win.loadFile(path.join(__dirname, '..', 'assets', 'logo.svg'));
    await delay(250);
    let big = await win.webContents.capturePage();
    if (big.getSize().width < 200) {
      // Algunos GPU no pintan ventanas transparentes: reintento opaco (esquinas azul noche)
      win.destroy();
      win = new BrowserWindow({
        width: 256, height: 256, show: true, frame: false,
        useContentSize: true, center: true, focusable: false, skipTaskbar: true, alwaysOnTop: true,
        backgroundColor: '#0A1F3C'
      });
      await win.loadFile(path.join(__dirname, '..', 'assets', 'logo.svg'));
      await delay(250);
      big = await win.webContents.capturePage();
    }
    if (big.getSize().width < 200) throw new Error('render base vacío');

    // Escala desde el render de 256px: un solo repintado, sin condiciones de carrera
    const pngs = [];
    for (const size of SIZES_ICO) {
      const buf = big.resize({ width: size, height: size, quality: 'best' }).toPNG();
      if (buf.length < 100) throw new Error(`escala vacía a ${size}px`);
      pngs.push({ size, buf });
      fs.writeFileSync(path.join(BUILD_DIR, `icon-${size}.png`), buf);
    }
    fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), packIco(pngs));
    fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), pngs[pngs.length - 1].buf); // 256
    console.log('ICONOS OK');
  } catch (e) {
    console.error('ICONOS FALLO', e.message);
    process.exitCode = 1;
  } finally {
    if (win) win.destroy();
    app.quit();
  }
});
