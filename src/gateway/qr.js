// A QR code as an SVG string, for the WeChat login in the settings page. The
// login payload never leaves this machine (no third-party QR image service).
import qrcode from '../vendor/qrcode-generator.mjs'

const utf8 = (text) => [...new TextEncoder().encode(text)]

export function qrSvg(text, { cellSize = 6, margin = 4 } = {}) {
  const previous = qrcode.stringToBytes
  qrcode.stringToBytes = utf8
  try {
    const code = qrcode(0, 'M')
    code.addData(text, 'Byte')
    code.make()
    return code.createSvgTag({ cellSize, margin, scalable: true })
  } finally {
    qrcode.stringToBytes = previous
  }
}
