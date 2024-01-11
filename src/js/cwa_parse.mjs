
function readTimestamp(packedTimestamp) {
    if (packedTimestamp == 0x00000000) return 0;    // Infinitely in past = 'always before now'
    if (packedTimestamp == 0xffffffff) return -1;   // Infinitely in future = 'always after now'
    // bit pattern:  YYYYYYMM MMDDDDDh hhhhmmmm mmssssss
    const year  = ((packedTimestamp >> 26) & 0x3f) + 2000;
    const month = (packedTimestamp >> 22) & 0x0f;
    const day   = (packedTimestamp >> 17) & 0x1f;
    const hours = (packedTimestamp >> 12) & 0x1f;
    const mins  = (packedTimestamp >>  6) & 0x3f;
    const secs  = (packedTimestamp >>  0) & 0x3f;
    try {
        return new Date(Date.UTC(year, month - 1, day, hours, mins, secs));
    } catch (e) {
        console.log('WARNING: Invalid date: ' + e);
        return null;
    }
}


export function parseHeader(data) {
    const header = {};

    // Minimum of one-sector
    if (data.byteLength < 512) {
        throw new Error('Data too short: ' + data.byteLength + ' (expected >= 512)');
    }

    // Header 'MD'
    if (data.getUint8(0) != 'M'.charCodeAt(0) || data.getUint8(1) != 'D'.charCodeAt(0)) {
        throw new Error('Invalid header: ' + String.fromCharCode(data.getUint8(0)) + String.fromCharCode(data.getUint8(1)));
    }

    // Header length (1020)
    header.length = data.getUint16(2, true);
    if (header.length < 512-4) {
        throw new Error('Invalid header length: ' + header.length + ' (expected >= 512-4)');
    }

    // Device type (0x00/0xff/0x17 = AX3, 0x64 = AX6)
    header.hardwareType = data.getUint8(4);
    if (header.hardwareType == 0x00 || header.hardwareType == 0x17) header.deviceType = 'AX3';
    else if (header.hardwareType == 0x64) header.deviceType = 'AX6';
    else header.deviceType = '?';

    // Device ID
    header.deviceId = data.getUint16(5, true);
    const deviceIdUpper = data.getUint16(11, true);
    if (deviceIdUpper != 0xffff) {
        header.deviceId |= deviceIdUpper << 16;
    }

    // Session ID
    header.sessionId = data.getUint32(7, true);

    // Start/end/capacity
    header.loggingStart = readTimestamp(data.getUint32(13, true));
    header.loggingEnd = readTimestamp(data.getUint32(17, true));
    header.loggingCapacity = data.getUint32(21, true);

    // Config
    header.flashLed = data.getUint8(26, true);
    header.sensorConfig = data.getUint8(35, true);
    if (header.sensorConfig != 0x00 && header.sensorConfig != 0xff) {
        header.gyroRange = 8000 / (2 ** (header.sensorConfig & 0x0f));
    } else {
        header.gyroRange = null;
    }
    header.rateCode = data.getUint8(36, true);
    header.frequency = 3200 / (1 << (15 - (header.rateCode & 0x0f)));
    header.range = 16 >> (header.rateCode >> 6);
    header.lastChange = readTimestamp(data.getUint32(37, true));
    header.firmwareRevision = data.getUint8(41, true);
    
    // Raw metadata (end-padding trimmed)
    header.metadataRaw = (new TextDecoder('utf-8')).decode(data.buffer.slice(64, 64 + 448));
    for (let i = header.metadataRaw.length - 1; i >= 0; i--) {
        const c = header.metadataRaw.charCodeAt(i);
        if (c != 0x00 && c != 0x20 && c != 0xff) {
            header.metadataRaw = header.metadataRaw.slice(0, i + 1);
            break;
        }
        if (i == 0) {
            header.metadataRaw = '';
            break;
        }
    }

    return header;
}

