/**
 * services/zip_writer.js
 *
 * A small .zip writer for call recordings. Audio is already compressed, so files are stored as they are
 * (no deflate), which keeps it simple and fast and needs no extra package. File names are written as UTF-8,
 * so Hindi and Telugu names survive. It handles up to 65,534 files and 4 GB, far more than a download here uses.
 *
 *   const zip = new ZipWriter((chunk) => writeToResponse(chunk));
 *   await zip.addFile('Asha_2026-10-30_919999999999.mp3', buffer);
 *   await zip.finish();
 */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
    const d = Number.isNaN(date.getTime()) ? new Date() : date;
    const year = Math.max(1980, d.getUTCFullYear());
    return {
        time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
        date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()
    };
}

export class ZipWriter {
    /** write(buffer) sends the bytes on; it may return a promise (for example to wait for a socket to drain). */
    constructor(write) {
        this.write = write;
        this.offset = 0;
        this.entries = [];
    }

    async emit(buffer) {
        await this.write(buffer);
        this.offset += buffer.length;
    }

    async addFile(name, data, modified = new Date()) {
        if (this.entries.length >= 65534) throw new Error('Too many files for one zip.');
        if (this.offset + data.length > 0xFFFFFFFF - 1024 * 1024) throw new Error('The zip would be too large.');
        const nameBuf = Buffer.from(String(name), 'utf8');
        const { time, date } = dosDateTime(modified);
        const crc = crc32(data);

        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0); // local file header
        header.writeUInt16LE(20, 4);         // version needed
        header.writeUInt16LE(0x0800, 6);     // flags: names are UTF-8
        header.writeUInt16LE(0, 8);          // method: stored
        header.writeUInt16LE(time, 10);
        header.writeUInt16LE(date, 12);
        header.writeUInt32LE(crc, 14);
        header.writeUInt32LE(data.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(nameBuf.length, 26);
        header.writeUInt16LE(0, 28);         // extra field length

        const entry = { nameBuf, crc, size: data.length, time, date, offset: this.offset };
        await this.emit(header);
        await this.emit(nameBuf);
        await this.emit(data);
        this.entries.push(entry);
    }

    async finish() {
        const centralStart = this.offset;
        for (const e of this.entries) {
            const rec = Buffer.alloc(46);
            rec.writeUInt32LE(0x02014b50, 0); // central directory header
            rec.writeUInt16LE(20, 4);         // made by
            rec.writeUInt16LE(20, 6);         // version needed
            rec.writeUInt16LE(0x0800, 8);
            rec.writeUInt16LE(0, 10);
            rec.writeUInt16LE(e.time, 12);
            rec.writeUInt16LE(e.date, 14);
            rec.writeUInt32LE(e.crc, 16);
            rec.writeUInt32LE(e.size, 20);
            rec.writeUInt32LE(e.size, 24);
            rec.writeUInt16LE(e.nameBuf.length, 28);
            rec.writeUInt32LE(e.offset, 42);
            await this.emit(rec);
            await this.emit(e.nameBuf);
        }
        const centralSize = this.offset - centralStart;
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0); // end of central directory
        end.writeUInt16LE(this.entries.length, 8);
        end.writeUInt16LE(this.entries.length, 10);
        end.writeUInt32LE(centralSize, 12);
        end.writeUInt32LE(centralStart, 16);
        await this.emit(end);
    }
}
