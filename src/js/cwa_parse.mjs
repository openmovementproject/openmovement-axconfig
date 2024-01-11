
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

function short_sign_extend(value) {
    return ((value + 0x8000) & 0xffff) - 0x8000;
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

export function parseData(data) {
    const result = {};

    // Minimum of one-sector
    if (data.byteLength < 512) {
        throw new Error('Data too short: ' + data.byteLength + ' (expected >= 512)');
    }

    // Header 'AX'
    if (data.getUint8(0) != 'A'.charCodeAt(0) || data.getUint8(1) != 'X'.charCodeAt(0)) {
        throw new Error('Invalid data header: ' + String.fromCharCode(data.getUint8(0)) + String.fromCharCode(data.getUint8(1)));
    }

    // Header length (508)
    result.length = data.getUint16(2, true);
    if (result.length != 512-4) {
        throw new Error('Invalid data length: ' + result.length + ' (expected >= 512-4)');
    }
    result.deviceFractional = data.getUint16(4, true);
    result.sessionId = data.getUint32(6, true);
    result.sequenceId = data.getUint32(10, true);
    result.timestampRaw = readTimestamp(data.getUint32(14, true));
    result.lightRaw = data.getUint16(18, true);
    result.light = result.lightRaw & 0x03ff;
    result.temperatureRaw = data.getUint16(20, true);
    result.temperature = (result.temperatureRaw & 0x03ff) * 75.0 / 256 - 50;
    result.events = data.getUint8(22, true);
    result.batteryStored = data.getUint8(23, true);
    result.batteryRaw = result.batteryStored;
    result.battery = (result.batteryRaw + 512.0) * 6000 / 1024 / 1000.0;
    result.rateCode = data.getUint8(24, true);
    result.numAxesBPS = data.getUint8(25, true);
    result.timestampOffsetRaw = data.getInt16(26, true);
    result.sampleCount = data.getUint16(28, true);

    result.frequency = 3200 / (1 << (15 - (result.rateCode & 0x0f)));
    result.channels = (result.numAxesBPS >> 4) & 0x0f;
    result.bytesPerAxis = result.numAxesBPS & 0x0f;
    if (result.bytesPerAxis == 0 && result.channels == 3) {
        result.bytesPerSample = 4;
    } else if (result.bytesPerAxis > 0 && result.channels > 0) {
        result.bytesPerSample = result.bytesPerAxis * result.channels;
    }
    result.samplesPerSector = 480 / result.bytesPerSample;

    let accelAxis = -1;
    let gyroAxis = -1;
    let magAxis = -1;
    if (result.channels >= 6) {
        gyroAxis = 0;
        accelAxis = 3;
        if (result.channels >= 9) {
            magAxis = 6;
        }
    } else if (result.channels >= 3) {
        accelAxis = 0;
    }

    let accelUnit = 256;     // 1g = 256
    let gyroRange = 2000;    // 32768 = 2000dps
    let magUnit = 16;        // 1uT = 16
    // light is least significant 10 bits, accel scale 3-MSB, gyro scale next 3 bits: AAAGGGLLLLLLLLLL
    accelUnit = 1 << (8 + ((result.lightRaw >> 13) & 0x07));
    if ((result.lightRaw >> 10) & 0x07 != 0) {
        gyroRange = Math.floor(8000 / (1 << ((result.lightRaw >> 10) & 0x07)));
    }

    // Scale
    //accelScale = 1.0 / accelUnit;
    //gyroScale = gyroRange / 32768.0;
    //magScale = 1.0 / magUnit;

    // Range
    let accelRange = 16
    if (result.rateCode != 0) {
        accelRange = 16 >> (result.rateCode >> 6);
    }
    //magRange = 32768 / magUnit;
    
    // Unit
    let gyroUnit = 32768.0 / gyroRange;

    if (accelAxis >= 0) {
        result.accelAxis = accelAxis;
        result.accelRange = accelRange;
        result.accelUnit = accelUnit;
    }
    if (gyroAxis >= 0) {
        result.gyroAxis = gyroAxis;
        result.gyroRange = gyroRange;
        result.gyroUnit = gyroUnit;
    }
    if (magAxis >= 0) {
        result.magAxis = magAxis;
        result.magRange = magRange;
        result.magUnit = magUnit;
    }

    let timeFractional = 0;
    result.timestampOffset = result.timestampOffsetRaw;
    // if top-bit set, we have a fractional date
    if (result.deviceFractional & 0x8000 != 0) {
        // Need to undo backwards-compatible shim by calculating how many whole samples the fractional part of timestamp accounts for.
        timeFractional = (result.deviceFractional & 0x7fff) << 1;     // use original deviceId field bottom 15-bits as 16-bit fractional time
        result.timestampOffset += (timeFractional * result.frequency) >> 16; // undo the backwards-compatible shift (as we have a true fractional)
    }

    // Add fractional time to timestamp
    result.timestamp = new Date(result.timestampRaw.getTime() + (timeFractional / 65536) * 1000);


    // Parse samples
    result.samples = [];
    const block = new Uint8Array(data.buffer, 30, 480);
    if (result.bytesPerSample == 4) {
        for (let i = 0; i < result.sampleCount; i++) {
            const ofs = i * 4;
            const val = block[ofs] | (block[ofs + 1] << 8) | (block[ofs + 2] << 16) | (block[ofs + 3] << 24);
            const ex = (6 - ((val >> 30) & 3));
            result.samples.push([
                (short_sign_extend((0xffc0 & (val <<  6))) >> ex) / accelUnit,
                (short_sign_extend((0xffc0 & (val >>  4))) >> ex) / accelUnit,
                (short_sign_extend((0xffc0 & (val >> 14))) >> ex) / accelUnit,
            ]);
        }
    } else if (result.bytesPerSample == 2) {
        for (let i = 0; i < result.sampleCount; i++) {
            const ofs = i * 2 * result.channels + 2 * accelAxis;
            result.samples.push([
                (block[ofs + 0] | (block[ofs + 1] << 8)) / accelUnit,
                (block[ofs + 2] | (block[ofs + 3] << 8)) / accelUnit,
                (block[ofs + 4] | (block[ofs + 5] << 8)) / accelUnit,
            ]);
        }

        if (gyroAxis >= 0) {
            result.samplesGyro = [];
            for (let i = 0; i < result.sampleCount; i++) {
                const ofs = i * 2 * result.channels + 2 * gyroAxis;
                result.samplesGyro.push([
                    (block[ofs + 0] | (block[ofs + 1] << 8)) / gyroUnit,
                    (block[ofs + 2] | (block[ofs + 3] << 8)) / gyroUnit,
                    (block[ofs + 4] | (block[ofs + 5] << 8)) / gyroUnit,
                ]);
            }
        }
    } else {
        console.log('ERROR: Unsupported bytes-per-sample: ' + result.bytesPerSample);
    }

    return result;
}

