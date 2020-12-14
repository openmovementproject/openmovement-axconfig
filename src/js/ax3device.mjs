import { sleep, localTime } from './util.mjs';

/*
{
    '_c':   'StudyCentre',
    '_s':   'StudyCode',
    '_i':   'StudyInvestigator', 
    '_x':   'StudyExerciseType',
    '_so':  'StudyOperator',
    '_n':   'StudyNotes',
    '_p':   'SubjectSite', // - / left wrist / right wrist / waist / left ankle / right ankle / left thigh / right thigh / left hip / right hip / left upper-arm / right upper-arm / chest / sacrum / neck / head
    '_sc':  'SubjectCode',
    '_se':  'SubjectSex',  // - / male / female
    '_h':   'SubjectHeight',
    '_w':   'SubjectWeight',
    '_ha':  'SubjectHandedness', // - / left / right
    '_sn':  'SubjectNotes',
};
*/

function getSerialNumber(serial) {
    if (serial === undefined || serial === null) return null;
    serial = serial.trim();
    if (!serial.startsWith('AX') && !serial.startsWith('CWA')) return null;
    for (let i = serial.length - 1; ; i--) {
        if (i < 0 || !(serial.charCodeAt(i) >= 0x30 && serial.charCodeAt(i) <= 0x39)) {
            if (i + 1 >= serial.length) {
                return null;
            }
            return parseInt(serial.substring(i + 1));
        }
    }
}


class Command {
    constructor(output, prefix, timeout) {
        this.output = output;
        this.prefix = prefix;
        this.timeout = timeout;
    }

    isTerminal(line) {
        if (this.prefix || this.prefix === '') {
            if (line.startsWith(this.prefix)) {
                return true;
            }
        }
        return false;
    }
}


class CommandState {
    constructor(command) {
        this.started = (new Date()).getTime();
        this.command = command;
        this.promise = new Promise(
            (resolve, reject) => {
                this.resolve = resolve;
                this.reject = reject;
             }
        );
        this.lines = [];
        this.completed = false;
        this.error = null;
    }

    addResponse(line) {
        this.lines.push(line);
        const terminal = this.command.isTerminal(line);
        console.log(`...now have ${this.lines.length} line(s) (terminal=${terminal})`);
        if (terminal) {
            return true;
        }
        return false;
    }

    lastLine() {
        if (this.completed && this.lines.length > 0) {
            return this.lines[this.lines.length - 1];
        } else {
            return null;
        }
    }

    complete(e = null) {
        if (typeof(e) !== 'undefined' && e !== null) {
            console.log('COMMAND-REJECT: ' + e);
            this.error = e;
            this.reject(this);    
        } else {
            console.log('COMMAND-RESOLVE');
            this.completed = true;
            this.resolve(this);
        }
    }

    checkTimeout() {
        const now = (new Date()).getTime();
        const elapsed = now - this.started;
        if (!this.completed && !this.error && this.command.timeout && elapsed >= this.command.timeout) {
            return true;
        }
        return false;
    }
    
}



export default class Ax3Device {

    constructor(device) {
        this.device = device;
        console.log('--- COMMS ---');
        console.log(this.device.productName);
        console.log(this.device.manufacturerName);
        console.log(this.device.serialNumber);

        this.serial = getSerialNumber(this.device.serialNumber);
        console.log('SERIAL: ' + this.serial);

        this.deviceType = null;
        if (this.device.serialNumber) {
            const serial = this.device.serialNumber.trim();
            if (serial.startsWith('CWA')) this.deviceType = 'AX3';
            else if (serial.startsWith('AX')) this.deviceType = serial.substring(0, 3);
        }
        this.hasGyro = (this.deviceType === 'AX6');

        this.commandQueue = [];
        this.currentCommand = null;
        this.currentTimeout = null;
        this.rejectRead = null;
        this.nextTick = null;
        this.receiveBuffer = '';
        this.statusHandler = null;

        this.status = {
            id: { deviceId: null },
            battery: { percent: null, time: null },
            start: null,
            stop: null,
            state: null,
            errorState: null,
        }
        this.recalculateRecordingStatus();
    }

    setStatusHandler(statusHandler) {
        this.statusHandler = statusHandler;
    }

    statusChanged() {
        if (this.statusHandler) {
            this.statusHandler(this, this.status);
        }
    }

    updateState(state, errorState) {
        console.log('STATE: ' + state + ' / ' + errorState);
        this.status.state = state;
        this.status.errorState = errorState;
        this.statusChanged();
    }

    async exec(command) {
        console.log(`exec() command=${command.output.replace(/[\r\n]/g, '|')} commandQueue.length=${this.commandQueue.length} currentCommand=${this.currentCommand} nextTick=${this.nextTick}`);
        const commandState = new CommandState(command);
        this.commandQueue.push(commandState);
        // Bootstrap required?
        if (this.currentCommand == null && this.nextTick == null) {
            console.log('exec(): bootstrap');
            this.nextTick = setTimeout(async () => {
                console.log('exec(): bootstrap...');
                await this.execNext();
                console.log('exec(): bootstrap... done');
            }, 0);
        }
        console.log('exec(): return');
        return commandState.promise;
    }

    async execNext() {
        try {
            this.nextTick = true;  // signify pending
            console.log('execNext()');
            // Write...
            if (this.currentCommand == null) {
                console.log('execNext(): no command...');
                if (this.commandQueue.length <= 0) {
                    console.log('execNext(): no more commands');
                    this.nextTick = null;
                    return;
                }
                console.log('execNext(): getting next command...');
                this.currentCommand = this.commandQueue.shift();
                if (this.currentCommand.command.timeout) {
                    console.log('execNext(): setting up new timeout: ' + this.currentCommand.command.timeout);
                    this.currentTimeout = setTimeout(this.timeout.bind(this), this.currentCommand.command.timeout);
                } else {
                    console.log('execNext(): command has no timeout');
                }
                try {
                    console.log('execNext(): write: ' + this.currentCommand.command.output.replace(/[\r\n]/g, '|'));
                    await this.write(this.currentCommand.command.output);
                    console.log('execNext(): write: (done)');
                } catch (e) {
                    console.log('execNext(): write: exception: ' + e);
                    this.commandComplete(e);
                }
            }
            // Read/timeout
            if (this.currentCommand) {
                let data = null;
                try {
                    if (this.currentCommand && this.currentCommand.checkTimeout()) {
                        console.log('execNext(): timeout before read');
                        this.commandComplete('Timeout before read');
                    } else {
                        console.log('execNext(): read');
                        data = await this.read();
                    }
                } catch (e) {
                    console.log('execNext(): read exception: ' + e);
                    this.commandComplete(e);
                }
                if (data === null && this.device.type === 'serial') {
                    if (data === null) {
                        // Seems to be some glitch in not delivering buffered content, new bytes incoming seem to help...
                        await this.write('\r');
                        // Rather than tight poll on serial (where actual read is async)
                        await sleep(100);
                    }
                }
                if (this.currentCommand && data !== null) {
                    console.log('execNext(): adding data ' + data.length);
                    this.receiveBuffer += data;
                    for (;;) {
                        const eol = this.receiveBuffer.indexOf('\n');
                        if (eol < 0) break;
                        const line = this.receiveBuffer.slice(0, eol).trim();
                        console.log('LINE: ' + line);
                        this.receiveBuffer = this.receiveBuffer.slice(eol + 1);
                        if (this.currentCommand.addResponse(line)) {
                            console.log('execNext(): end');
                            this.commandComplete();
                            break;
                        }
                    }
                } else {
                    console.log('execNext(): (no command or no data) ');
                }
            }
        } catch (e) {
            console.log('execNext(): Exception during processing: ' + e)
        }
        // Invoke again shortly
        this.nextTick = setTimeout(async () => {
            console.log('execNext(): ...');
            await this.execNext();
            console.log('execNext(): ... done');
        }, 0);
        console.log('execNext(): end');
    }

    async timeout() {
        try {
            console.log('timeout(): ...');
            this.currentTimeout = null;
            if (this.rejectRead) {
                console.log('timeout(): ...reject read...');
                this.rejectRead(null);
            }
            if (this.currentCommand) {
                console.log('timeout(): ...cancel read...');
                await this.device.cancelRead();
                this.commandComplete('Timeout');
            } else {
                console.log('timeout(): no current command');
            }
            console.log('timeout(): ...done');
        } catch (e) {
            console.log('timeout(): ERROR: ' + e);
        }
    }

    commandComplete(e = null) {
        if (e !== null) {
            console.log('commandComplete(): FAILED ' + e + ' -- ' + (this.currentCommand ? this.currentCommand.command.output : '-'));
        } else {
            console.log('commandComplete(): SUCCESS -- ' + (this.currentCommand ? this.currentCommand.command.output : '-'));
        }
        if (this.currentTimeout) {
            clearTimeout(this.currentTimeout);
            this.currentTimeout = null;
        }
        if (this.currentCommand) {
            const curCmd = this.currentCommand;
            this.currentCommand = null;
            curCmd.complete(e);
        }
    }
    

    async open() {
        this.receiveBuffer = '';
        await this.device.open();
        console.log('...opened');
    }


    async close() {
        return await this.device.close();
    }


    async write(message) {
        await this.device.write(message);
    }


    async read() {
        const timeoutPromise = new Promise((resolve, reject) => {
            this.rejectRead = reject;
        });
        return Promise.race([
            timeoutPromise,
            this.device.read()
        ]);
    }

   
    parseDateTime(dateString)
    {
        if (dateString == '0') { return 0; }	// Infinitely early
        if (dateString == '-1') { return -1; }	// Infinitely late
        const year   = parseInt(dateString.substring(0, 4), 10);
        const month  = parseInt(dateString.substring(5, 7), 10);
        const day    = parseInt(dateString.substring(8, 10), 10);
        const hour   = parseInt(dateString.substring(11, 13), 10);
        const minute = parseInt(dateString.substring(14, 16), 10);
        const second = parseInt(dateString.substring(17, 19), 10);
        const date = new Date(year, month - 1, day, hour, minute, second, 0);
        if (date.getFullYear() < 2000) { return 0; }
        if (date.getFullYear() >= 2064) { return -1; }
        return date;
    }    

    packDateTime(newTime = null) {
        if (newTime === null) { newTime = new Date(); }
        if (newTime == 0) { return '0'; }	// Infinitely early
        if (newTime == -1) { return '-1'; }	// Infinitely late
        let timestr = newTime.getFullYear() + '/';
        timestr = timestr + ((newTime.getMonth() + 1 < 10) ? '0' : '') + (newTime.getMonth() + 1) + '/';
        timestr = timestr + ((newTime.getDate() < 10) ? '0' : '') + newTime.getDate() + ',';
        timestr = timestr + ((newTime.getHours() < 10) ? '0' : '') + newTime.getHours() + ':';
        timestr = timestr + ((newTime.getMinutes() < 10) ? '0' : '') + newTime.getMinutes() + ':';
        timestr = timestr + ((newTime.getSeconds() < 10) ? '0' : '') + newTime.getSeconds();
        return timestr;
    }    

    async getConfigOptions() {
        // TODO: Support AX6 (based on USB serial number)
        return {
            accelRate: [ 6.25, 12.5, 25, 50, 100, 200, 400, 800, 1600, 3200 ],
            accelRange: [ 2, 4, 8, 16 ],
        };
    }

    async getId() {
        const command = new Command(`\r\nID\r\n`, 'ID=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const parts = response.substring(response.indexOf('=') + 1).split(',');
        this.hasGyro = (parts[0] === 'AX6');
        return {
            deviceType: parts[0] == 'CWA' ? 'AX3' : parts[0],
            deviceId: parseInt(parts[3], 10),
            firmwareVersion: parseInt(parts[2], 10),
        };
    }

    async getBattery() {
        const command = new Command(`\r\nSAMPLE 1\r\n`, '$BATT=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        // "$BATT=718,4207,mV,98,1"
        const parts = response.substring(response.indexOf('=') + 1).split(',').map(x => parseInt(x, 10));
        return {
			voltage: parts[1] / 1000.0,
			percent: parts[3],
            charging: parts[4],
            time: new Date(),
        };
    }

    async setLed(ledValue) {
        const command = new Command(`\r\nLED ${ledValue}\r\n`, 'LED=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const parts = response.substring(response.indexOf('=') + 1).split(',').map(x => parseInt(x, 10));
        if (parts[0] != ledValue) {
            throw `LED value unexpected: was ${parts[0]}, expected ${ledValue}`;
        }
    }

    async setTime(newTime = null) {
        this.updateState('Configuring: Setting time');
        let time = newTime;
        if (time === null) {
            time = new Date();
        }
        const timeStr = this.packDateTime(time);
        const command = new Command(`\r\nTIME ${timeStr}\r\n`, '$TIME=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const returnTime = this.parseDateTime(response.substring(response.indexOf('=') + 1));
        const difference = returnTime.getTime() - time.getTime();
        if (Math.abs(difference) > 2000) {
            throw `Time value difference too large: received ${returnTime.toISOString()}, expected closer to ${time.toISOString()}`;
        }
    }

    async setSession(inSessionId) {
        const sessionId = parseInt(inSessionId)
        this.updateState('Configuring: Setting session ID');
        if (typeof sessionId !== 'number' || isNaN(sessionId) || sessionId < 0 || sessionId > 2147483647) throw "Session ID invalid value";
        const command = new Command(`\r\nSESSION ${sessionId}\r\n`, 'SESSION=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const parts = response.substring(response.indexOf('=') + 1).split(',').map(x => parseInt(x, 10));
        if (parts[0] != sessionId) {
            throw `SESSION value unexpected: was ${parts[0]}, expected ${sessionId}`;
        }
    }

    async setMaxSamples(maxSamples) {
        this.updateState('Configuring: Setting max. samples');
        const command = new Command(`\r\nMAXSAMPLES ${maxSamples}\r\n`, 'MAXSAMPLES=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const parts = response.substring(response.indexOf('=') + 1).split(',').map(x => parseInt(x, 10));
        if (parts[0] != maxSamples) {
            throw `MAXSAMPLES value unexpected: was ${parts[0]}, expected ${maxSamples}`;
        }
    }

    async getHibernate(time) {
        const command = new Command(`\r\nHIBERNATE\r\n`, 'HIBERNATE=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const value = response.substring(response.indexOf('=') + 1);
        return this.parseDateTime(value);
    }

    async setHibernate(time) {
        this.updateState('Configuring: Setting start');
        const timestamp = this.packDateTime(time);
        const command = new Command(`\r\nHIBERNATE ${timestamp}\r\n`, 'HIBERNATE=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const newValue = response.substring(response.indexOf('=') + 1);
        if (timestamp != newValue) {
            throw `HIBERNATE value unexpected: was ${newValue}, expected ${timestamp}`;
        }
    }

    async getStop(time) {
        const command = new Command(`\r\nSTOP\r\n`, 'STOP=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const value = response.substring(response.indexOf('=') + 1);
        return this.parseDateTime(value);
    }

    async setStop(time) {
        this.updateState('Configuring: Setting stop');
        const timestamp = this.packDateTime(time);
        const command = new Command(`\r\nSTOP ${timestamp}\r\n`, 'STOP=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const newValue = response.substring(response.indexOf('=') + 1);
        if (newValue.indexOf(timestamp) < 0) {
            throw `STOP value unexpected: was ${newValue}, expected ${timestamp}`;
        }
    }

    async setRate(rate, range, gyro) {
        this.updateState('Configuring: Setting rate');
        let value = 0x00;

        switch (parseFloat(rate))
        {
            case 3200: value |= 0x0f; break;
            case 1600: value |= 0x0e; break;
            case  800: value |= 0x0d; break;
            case  400: value |= 0x0c; break;
            case  200: value |= 0x0b; break;
            case  100: value |= 0x0a; break;
            case   50: value |= 0x09; break;
            case   25: value |= 0x08; break;
            case   12.5: case 12: value |= 0x07; break;
            case    6.25: case 6: value |= 0x06; break;
            default: throw('Invalid accelerometer frequency.');
        }
        if (this.hasGyro && parseFloat(rate) > 1600) {
            throw('This device has a maximum rate of 1600Hz')
        }
        if (this.hasGyro && parseFloat(rate) < 25) {
            throw('This device has a minimum rate of 25Hz')
        }
				
        switch (parseInt(range))
        {
            case 16:   value |= 0x00; break;
            case  8:   value |= 0x40; break;
            case  4:   value |= 0x80; break;
            case  2:   value |= 0xC0; break;
            default: throw('Invalid accelerometer sensitivity.');
        }

        let gyroRange = null;
        if (gyro) {
            if (!this.hasGyro) {
                throw('Cannot configure gyroscope on device without gyroscope.')
            }
            switch (parseInt(gyro))
            {
                case 2000:
                case 1000:
                case  500:
                case  250:
                    gyroRange = parseInt(gyro);
                    break;
                default: throw('Invalid gyro range: ' + parseInt(gyro));
            }
        }

        const command = new Command(gyroRange ? `\r\nRATE ${value},${gyroRange}\r\n` : `\r\nRATE ${value}\r\n`, 'RATE=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const parts = response.substring(response.indexOf('=') + 1).split(',').map(x => parseInt(x, 10));
        if (parts[0] != value) {
            throw `RATE value unexpected: was ${parts[0]}, expected ${value}`;
        }
        if (parts[1] != rate) {
            throw `RATE frequency unexpected: was ${parts[1]}, expected ${rate}`;
        }
        if (gyroRange && parts[2] != gyroRange) {
            throw `RATE gyro range unexpected: was ${parts[2]}, expected ${gyroRange}`;
        }
    }

    async setDebug(debugCode) {
        let debugValue = (debugCode === true) ? 3 : +debugCode;     // true = debug code 3; false = debug code 0
        this.updateState('Configuring: Setting flash status');
        const command = new Command(`\r\DEBUG ${debugValue}\r\n`, 'DEBUG=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const parts = response.substring(response.indexOf('=') + 1).split(',').map(x => parseInt(x, 10));
        if (parts[0] != debugValue) {
            throw `DEBUG value unexpected: was ${parts[0]}, expected ${debugValue}`;
        }
    }

    async readSector(sectorNumber) {
        const bytesPerLine = 16;
        const sectorSize = 512;
        const command = new Command(`\r\nREADL ${sectorNumber}\r\n`, 'OK', 10000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const buffer = new DataView(new ArrayBuffer(sectorSize), 0);
        let currentOffset = 0;
        for (let line of result.lines) {
            if (line.startsWith('READL=')) continue;
            if (line.startsWith('OK')) continue;
            const offsetString = line.split(':', 1);
            const offset = parseInt(offsetString, 16);
            if (offset != currentOffset) {
                throw `Unexpected sector offset ${offset}, expected ${currentOffset}`;
            }
            const valueString = line.trim().slice(offsetString.length + 1, -bytesPerLine).replace(/\ /g, '');
            const byteCount = valueString.length / 2;
            if (byteCount != bytesPerLine) {
                throw `Unexpected sector line length ${valueString.length} -> ${byteCount}, expected ${2 * bytesPerLine} -> ${bytesPerLine}`;
            }
            for (let i = 0; i < byteCount; i++) {
                const byte = parseInt(valueString.slice(i * 2, i * 2 + 2), 16);
                buffer.setUint8(byte);
                currentOffset++;
            }
        }
        if (currentOffset != sectorSize) {
            throw `Unexpected sector size ${currentOffset}, expected ${sectorSize}`;
        }
        //console.log('<<< ' + response);
        return buffer;
    }
    
    async readFilesystem() {
        this.updateState('Reading filesystem');
        // FAT16
        const filesystem = {};
        filesystem.mbrSector = await this.readSector(0);
        filesystem.firstSectorNumber = filesystem.mbrSector.getUint32(454, true); // 94
        filesystem.bootSector = await this.readSector(filesystem.firstSectorNumber);
        filesystem.sectorsPerCluster = filesystem.bootSector.getUint16(12, true);   // 16384
        filesystem.numReservedSectors = filesystem.bootSector.getUint16(14, true);  // 8
        filesystem.numFATs = filesystem.bootSector.getUint8(16);    // 2
        filesystem.numRootDirectoryEntries = filesystem.bootSector.getUint16(17, true); // 512
        filesystem.sectorsPerFAT = filesystem.bootSector.getUint16(22, true); // 61
        filesystem.rootSectorNumber = filesystem.firstSectorNumber + filesystem.numReservedSectors + (filesystem.numFATs * filesystem.sectorsPerFAT); // 224
        filesystem.rootSector = await this.readSector(filesystem.rootSectorNumber);
        filesystem.firstSectorOfFileArea = filesystem.rootSectorNumber + Math.floor((32 * filesystem.numRootDirectoryEntries) / 512);

        // Scan first sector of root directory
        filesystem.dataLength = null;
        for (let i = 0; i < 16; i++) {
            const offset = 32 * i;
            const entry = 'CWA-DATACWA';
            let match = true;
            for (let o = 0; o < entry.length; o++) {
                if (filesystem.rootSector.getUint8(offset + o) != entry.charCodeAt(o)) {
                    match = false;
                    break;
                }
            }
            if (match) {
                filesystem.dataLength = filesystem.rootSector.getUint32(offset + 28, true);
                break;
            }
        }

        return {
            //mbrSector,
            firstSectorNumber,
            //bootSector,
            sectorsPerCluster,
            numReservedSectors,
            numFATs,
            numRootDirectoryEntries,
            sectorsPerFAT,
            rootSectorNumber,
            //rootSector,
            firstSectorOfFileArea,
            dataLength,
        };
    }


    async setMetadata(metadata) {
        const stride = 32;
        const count = 14;
        for (let i = 0; i < count; i++)
        {
            this.updateState(`Configuring: Setting metadata (${i + 1} / ${count})`);
            let strip = '';
            const start = i * stride;
            let end = (i + 1) * stride;
            if (start < metadata.length)
            {
                if (end > metadata.length) { end = metadata.length; }
                {
                    strip = metadata.substring(start, end);
                }
            }
            const cmdOut = 'Annotate' + (i < 10 ? '0' : '') + i + '=' + strip + '\r\n';
            const cmdIn = 'ANNOTATE' + (i < 10 ? '0' : '') + i + '=';
            await this.tryAndRetry(async () => {
                const command = new Command(`\r\n${cmdOut}\r\n`, cmdIn, 1000);
                console.log('>>> ' + command.output + '|');
                const result = await this.exec(command);
                const response = result.lastLine();
                console.log('<<< ' + response);
                const returnValue = response.substring(response.indexOf('=') + 1);
                if (returnValue.trim() != strip.trim()) {
                    throw `${cmdIn} unexpected value, received "${returnValue.trim()}", expected "${strip.trim()}"`;
                }
            });
        }
    }

    async commit(wipe) {
        let command;
        if (wipe === true) {
            this.updateState('Configuring: Wiping and committing');
            command = new Command(`\r\nFORMAT WC\r\n`, 'COMMIT', 10000);
        } else if (wipe === false) {
            this.updateState('Configuring: Erasing and committing');
            command = new Command(`\r\nFORMAT QC\r\n`, 'COMMIT', 8000);
        } else if (wipe === null) {
            this.updateState('Configuring: Committing');
            command = new Command(`\r\nCommit\r\n`, 'COMMIT', 5000);
        } else {
            throw 'ERROR: Unknown commit type.';
        }
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
    }

    async tryAndRetry(task, retries = 3, interval = 1000) {
        let lastException = "Unexpected failure in retry logic.";
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                if (interval && attempt > 0) {
                    console.log(`Retrying in ${interval/1000}s...`);
                    await sleep(interval);
                }
                return await task();
            } catch (e) {
                lastException = e;
                console.log(`WARNING: Failed attempt (${attempt + 1}/${retries}): ` + (e.error ? e.error : e));
            }
        }
        throw lastException;
    }

    async updateStatus() {
        if (this.device.isBusy()) {
            this.updateState(null, 'Device busy');
            throw('ERROR: Device is busy');
        }
        try {
            this.updateState('Querying status');

            await this.tryAndRetry(() => this.open());

            if (this.status.id === null || this.status.id.deviceId === null) {
                this.status.id = await this.tryAndRetry(() => this.getId());  // id.deviceId
                if (this.status.id.deviceId != this.serial) {
                    if (this.serial === null && this.device.type === 'serial') {
                        console.log(`WARNING: Serial API did not return serial number, so not verifying reported: ID=${this.status.id.deviceId}`);
                    } else {
                        throw `ERROR: Device id mismatch: reported ID=${this.status.id.deviceId} but serial number was ${this.serial}.`;
                    }
                }
                console.log('ID=' + JSON.stringify(this.status.id));    
            }

            const now = new Date();
            if (this.status.battery === null || this.status.battery.percent === null || this.status.battery.time === null || now.getTime() - this.status.battery.time.getTime() >= 30 * 1000) {
                this.status.battery = await this.tryAndRetry(() => this.getBattery()); // battery.percent
                console.log('BATTERY=' + JSON.stringify(this.status.battery));
            }

            if (this.status.start === null) {
                this.status.start = await this.tryAndRetry(() => this.getHibernate());
            }

            if (this.status.stop === null) {
                this.status.stop = await this.tryAndRetry(() => this.getStop());
            }

            this.recalculateRecordingStatus();

            return this.status;
        } catch (e) {
            if (e.error) {
                this.updateState(null, `Error getting status: ${e.error}`);
                console.log('ERROR: Problem during status update: ' + e.error);
            } else {
                this.updateState(null, `Error getting status: ${e}`);
                console.log('ERROR: Problem during status update: ' + e);
            }
            throw e;
        } finally {
            await this.close();
        }
    }

    recalculateRecordingStatus(justConfigured = false) {
        const DATE_MIN = Date.UTC(-271821, 3, 20);
        const DATE_MAX = Date.UTC(275760, 8, 13);

        const now = localTime(new Date());

        let from = this.status.start;
        if (from === -1) from = DATE_MAX;
        if (from === 0) from = DATE_MIN;

        let until = this.status.stop;
        if (until === -1) from = DATE_MAX;
        if (until === 0) from = DATE_MIN;
        
        this.status.recordingConfigured = from < until;
        this.status.recordingFinished = this.status.recordingConfigured && now >= until;
        this.status.recordingStarted = this.status.recordingConfigured && now >= from && !this.status.recordingFinished;
        this.status.recordingIncomplete = this.status.recordingConfigured && !this.status.recordingFinished;

        let state = justConfigured ? 'Configured: ' : '';
        if (this.status.recordingConfigured) {
            if (this.status.recordingFinished) state += 'Recording complete';
            else if (this.status.recordingStarted) state += 'Recording started';
            else state += 'Configured';
        } else {
            state = justConfigured ? 'Settings cleared' : 'Ready';
        }
        this.updateState(state);
        //this.statusChanged();
    }


    async configure(newConfig) {
        if (this.device.isBusy()) {
            this.updateState(null, 'Device busy');
            throw('ERROR: Device is busy');
        }

        try {
            this.updateState('Configuring...');
            await this.tryAndRetry(() => this.open());

            const defaultConfig = {
                minBattery: null,
                configLed: Ax3Device.LED_BLUE,
                time: null,
                session: 0,
                maxSamples: 0,
                rate: 100,  // synchronous rate
                range: 8,   // accel range
                gyro: 0,    // gyro range
                start: -1,  // sleep forever
                stop: 0,        // stop always
                metadata: '',
                led: Ax3Device.LED_MAGENTA,
                wipe: true,     // true=wipe first, false=rewrite filesystem, null=commit over
                noData: false,
                debug: false,
            };

            for (let key of Object.keys(newConfig)) {
                if (!(key in defaultConfig)) {
                    throw `ERROR: Unknown configuration value: ${key}`;
                }
            }

            const config = Object.assign(defaultConfig, newConfig);

            console.log('ID=' + JSON.stringify(this.status.id));
            if (this.status.id.deviceId != this.serial) {
                if (this.serial === null && this.device.type === 'serial') {
                    console.log(`WARNING: Serial API did not return serial number, so not verifying reported: ID=${this.status.id.deviceId}`);
                } else {
                    throw `ERROR: Device id mismatch (was status updated first?): reported ID=${this.status.id.deviceId} but USB serial number was ${this.serial}.`
                }
            }

            await this.tryAndRetry(() => this.setLed(config.configLed));

            console.log('BATTERY=' + JSON.stringify(this.status.battery));
            if (this.status.battery.percent < config.minBattery) {
                throw `ERROR: Device battery level too low: ${this.status.battery.percent}% (required ${config.minBattery}%).`
            }

            if (config.noData) {
                const filesystem = await this.tryAndRetry(() => this.readFilesystem());
                console.log('FILESYSTEM=' + JSON.stringify(filesystem));
                if (filesystem.dataLength && filesystem.dataLength > 1024) {
                    throw 'ERROR: Device has data on it.'
                }
            }

            if (!config.time) {
                config.time = new Date();
            }

            await this.tryAndRetry(() => this.setTime(config.time));
            await this.tryAndRetry(() => this.setRate(config.rate, config.range, config.gyro));
            await this.tryAndRetry(() => this.setSession(config.session));
            await this.tryAndRetry(() => this.setMaxSamples(config.maxSamples));
            await this.tryAndRetry(() => this.setDebug(config.debug ? 3 : 0));
            await this.tryAndRetry(() => this.setHibernate(config.start));
            await this.tryAndRetry(() => this.setStop(config.stop));
            await this.tryAndRetry(() => this.setMetadata(config.metadata));
            await this.tryAndRetry(() => this.commit(config.wipe));

            this.status.start = config.start;
            this.status.stop = config.stop;
            this.recalculateRecordingStatus(true);

            await this.tryAndRetry(() => this.setLed(config.led));

            // Return configuration report
            return {
                // Device information
                time: config.time,
                deviceId: this.status.id.deviceId,
                battery: battery.percent,
                // Config
                start: config.start,
                stop: config.stop,
                session: config.session,
                rate: config.rate,
                range: config.range,
                gyro: config.gyro,
                metadata: config.metadata,
            };
        } catch (e) {
            if (e.error) {
                this.updateState(null, `Error: ${e.error}`);
                console.log('ERROR: Problem during configuration: ' + e.error);
            } else {
                this.updateState(null, `Error: ${e}`);
                console.log('ERROR: Problem during configuration: ' + e);
            }
            throw e;
        } finally {
            await this.close();
        }
    }


}

// USB
Ax3Device.USB_DEVICE_VID = 0x04D8;
Ax3Device.USB_DEVICE_PID = 0x0057;

// LED Colours              // 0bRGB
Ax3Device.LED_OFF = 0;      // 0b000
Ax3Device.LED_BLUE = 1;     // 0b001
Ax3Device.LED_GREEN = 2;    // 0b010
Ax3Device.LED_CYAN = 3;     // 0b011
Ax3Device.LED_RED = 4;      // 0b100
Ax3Device.LED_MAGENTA = 5;  // 0b101
Ax3Device.LED_YELLOW = 6;   // 0b110
Ax3Device.LED_WHITE = 7;    // 0b111

