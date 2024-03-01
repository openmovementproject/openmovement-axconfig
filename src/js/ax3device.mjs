import { sleep, localTime, localTimeString } from './util.mjs';
import { parseHeader, parseData } from './cwa_parse.mjs';

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

import { streamSaver } from './streamsaver.mjs';

function dump(value) {
    // const result = {};
    // result.hex = [...new Uint8Array(value.buffer ? value.buffer : value)].map(x => x.toString(16).padStart(2, '0')).join('');
    // result.hexDump = result.hex.replace(/((?:[A-Za-z0-9]{2}){16})/g, '$1\n').trim().replace(/([A-Za-z0-9]{2})(?!\n)/g, '$1 ').trim();
    // result.base64 = btoa(String.fromCharCode(...new Uint8Array(value.buffer ? value.buffer : value)));
    // return result;
    return [...new Uint8Array(value.buffer ? value.buffer : value)].map(x => x.toString(16).padStart(2, '0')).join(' ');
}

let downloadScripts = false;
async function download(filename, fileSize, callback) {
    console.log('DOWNLOAD: start');

    // Dynamically load scripts
    if (!downloadScripts && downloadScripts !== false) {
        console.log('DOWNLOAD: scripts need to be dynamically loaded');
        const scriptSources = [
            './streamsaver/web-streams-polyfill.min.js',
            './streamsaver/StreamSaver.js',
        ];
        downloadScripts = [];
        for (const scriptSource of scriptSources) {
            const script = document.createElement('script');
            script.type = 'text/javascript';
            script.src = scriptSource;
            script.promise = new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
            });
            document.body.prepend(script);
            downloadScripts.push(script);
        }
    }

    // Wait for all of the scripts to load
    if (downloadScripts !== false) {
        console.log('DOWNLOAD: waiting for scripts to be loaded');
        await Promise.all(downloadScripts.map(script => script.promise));
        console.log('DOWNLOAD: scripts loaded');
    }

    // const useIframe = 'isSecureContext' in window && isSecureContext;
    // const usePopup = 'isSecureContext' in window && !isSecureContext;
    // const useLocationHref = !useIframe;
    // const useCrossOriginServiceWorker = new URL(streamSaver.mitm).origin !== window.origin;
    // let useMessageChannel = false;
    // let useTransformStream = false;
    // let keepServiceWorkerAlive = false;
    // try {
    //   const { readable } = new TransformStream();
    //   const mc = new MessageChannel();
    //   mc.port1.postMessage(readable, [readable]);
    //   mc.port1.close();
    //   mc.port2.close();
    //   useTransformStream = true;
    // } catch (e) {
    //   useMessageChannel = true;
    //   keepServiceWorkerAlive = true;
    // }

    // Over HTTPS, use local version of MITM for SW -- otherwise, will fall back to github.io version
    if (location.protocol == 'https:') {
        //streamSaver.mitm = './streamsaver/mitm.html';
    }

    const options = {};
    if (fileSize !== null && fileSize >= 0) {
        options.size = fileSize;
    }

    const fileStream = streamSaver.createWriteStream(filename, options);
    let writer = fileStream.getWriter();

    writer.fileSize = fileSize;

    const abort = () => {
        if (writer) {
            callback(null);
            writer.abort();
            writer = null;
        }
    }

    try {
        window.addEventListener('unload', abort);
        for (; ;) {
            if (!writer) {
                throw new Error('Writer is aborted');
            }
            // const byte = new TextEncoder().encode('!'); writer.write(byte);
            const result = await callback(writer);
            if (!result) {
                break;
            }
        }
        writer.close();
    } catch (e) {
        console.log('DOWNLOAD: error - ' + e);
        abort();
        throw e;
    } finally {
        window.removeEventListener('unload', abort);
    }

    return true;
}

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
    constructor(command, quiet = false) {
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
        this.quiet = quiet;
    }

    addResponse(line) {
        this.lines.push(line);
        const terminal = this.command.isTerminal(line);
        if (!this.quiet) console.log(`...now have ${this.lines.length} line(s) (terminal=${terminal})`);
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
            if (!this.quiet) console.log('COMMAND-RESOLVE');
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

    async exec(command, quiet = false) {
        const commandState = new CommandState(command, quiet);
        if (!commandState.quiet) console.log(`exec() command=${command.output.replace(/[\r\n]/g, '|')} commandQueue.length=${this.commandQueue.length} currentCommand=${this.currentCommand} nextTick=${this.nextTick}`);
        this.commandQueue.push(commandState);
        // Bootstrap required?
        if (this.currentCommand == null && this.nextTick == null) {
            if (!commandState.quiet) console.log('exec(): bootstrap');
            this.nextTick = setTimeout(async () => {
                if (!commandState.quiet) console.log('exec(): bootstrap...');
                await this.execNext();
                if (!commandState.quiet) console.log('exec(): bootstrap... done');
            }, 0);
        }
        if (!commandState.quiet) console.log('exec(): return');
        return commandState.promise;
    }

    async execNext() {
        try {
            this.nextTick = true;  // signify pending
            //console.log('execNext()');
            // Write...
            if (this.currentCommand == null) {
                //console.log('execNext(): no command...');
                if (this.commandQueue.length <= 0) {
                    //console.log('execNext(): no more commands');
                    this.nextTick = null;
                    return;
                }
                //console.log('execNext(): getting next command...');
                this.currentCommand = this.commandQueue.shift();
                if (this.currentCommand.command.timeout) {
                    if (!this.currentCommand.quiet) console.log('execNext(): setting up new timeout: ' + this.currentCommand.command.timeout);
                    this.currentTimeout = setTimeout(this.timeout.bind(this), this.currentCommand.command.timeout);
                } else {
                    console.log('execNext(): command has no timeout');
                }
                try {
                    if (!this.currentCommand.quiet) console.log('execNext(): write: ' + this.currentCommand.command.output.replace(/[\r\n]/g, '|'));
                    await this.write(this.currentCommand.command.output, this.currentCommand.quiet);
                    if (!this.currentCommand.quiet) console.log('execNext(): write: (done)');
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
                        if (!this.currentCommand.quiet) console.log('execNext(): read');
                        data = await this.read(this.currentCommand.quiet);
                    }
                } catch (e) {
                    console.log('execNext(): read exception: ' + e);
                    this.commandComplete(e);
                }
                if (data === null && this.device.type === 'serial') {
                    if (data === null) {
                        // Seems to be some glitch in not delivering buffered content, new bytes incoming seem to help...
                        await this.write('\r', this.currentCommand.quiet);
                        // Rather than tight poll on serial (where actual read is async)
                        await sleep(100);
                    }
                }
                if (this.currentCommand && data !== null) {
                    //console.log('execNext(): adding data ' + data.length);
                    this.receiveBuffer += data;
                    for (;;) {
                        const eol = this.receiveBuffer.indexOf('\n');
                        if (eol < 0) break;
                        const line = this.receiveBuffer.slice(0, eol).trim();
                        if (!this.currentCommand.quiet) console.log('LINE: ' + line);
                        this.receiveBuffer = this.receiveBuffer.slice(eol + 1);
                        if (this.currentCommand.addResponse(line)) {
                            if (!this.currentCommand.quiet) console.log('execNext(): end');
                            this.commandComplete();
                            break;
                        }
                    }
                } else {
                    //console.log('execNext(): (no command or no data) ');
                }
            }
        } catch (e) {
            console.log('execNext(): Exception during processing: ' + e)
        }
        // Invoke again shortly
        this.nextTick = setTimeout(async () => {
            //console.log('execNext(): ...');
            await this.execNext();
            //console.log('execNext(): ... done');
        }, 0);
        //console.log('execNext(): end');
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
            if (!(this.currentCommand && this.currentCommand.quiet)) console.log('commandComplete(): SUCCESS -- ' + (this.currentCommand ? this.currentCommand.command.output : '-'));
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


    async write(message, quiet) {
        await this.device.write(message, quiet);
    }


    async read(quiet) {
        const timeoutPromise = new Promise((resolve, reject) => {
            this.rejectRead = reject;
        });
        return Promise.race([
            timeoutPromise,
            this.device.read(quiet)
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
        const options = {};
        options.accelRate = [ 6.25, 12.5, 25, 50, 100, 200, 400, 800, 1600, 3200 ];
        options.accelRange = [ 2, 4, 8, 16 ];
        // Only works after updateStatus() / getId() called
        if (this.hasGyro) {
            options.gyroRange = [ 0, 250, 500, 1000, 2000 ];
        }
        return options;
    }

    async setId(id) {
        const command = new Command(`\r\nDEVICE=${id}\r\n`, 'DEVICE=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const parts = response.substring(response.indexOf('=') + 1).split(',').map(x => parseInt(x, 10));
        if (parts[0] != id || parts[1] != id) {
            throw `DEVICE value unexpected: was ${parts[0]} / ${parts[1]}, expected ${id}`;
        }
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

    async getTime() {
        const command = new Command(`\r\nTIME\r\n`, '$TIME=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const returnTimeRaw = response.substring(response.indexOf('=') + 1);
        const returnTime = this.parseDateTime(returnTimeRaw);
        return returnTime;  // returnTime.toISOString()
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

    async getSession() {
        const command = new Command(`\r\nSESSION\r\n`, 'SESSION=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const parts = response.substring(response.indexOf('=') + 1).split(',').map(x => parseInt(x, 10));
        const sessionId = parseInt(parts[0]);
        return sessionId;
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

    async getMaxSamples() {
        const command = new Command(`\r\nMAXSAMPLES\r\n`, 'MAXSAMPLES=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const parts = response.substring(response.indexOf('=') + 1).split(',').map(x => parseInt(x, 10));
        const maxSamples = parseInt(parts[0]);
        return maxSamples;
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

    async getRate() {
        const command = new Command(`\r\nRATE\r\n`, 'RATE=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        const response = result.lastLine();
        console.log('<<< ' + response);
        const parts = response.substring(response.indexOf('=') + 1).split(',').map(x => parseInt(x, 10));
        const rateCode = parseInt(parts[0]);

        let accelRange = 0;
        if ((rateCode & 0xC0) == 0x00) { accelRange = 16; }
        else if ((rateCode & 0xC0) == 0x40) { accelRange = 8; }
        else if ((rateCode & 0xC0) == 0x80) { accelRange = 4; }
        else if ((rateCode & 0xC0) == 0xC0) { accelRange = 2; }

        const rateResult = {
            rateCode,
            rate: parts.length > 1 ? parseInt(parts[1]) : null,
            accelRange,
            gyroRange: parts.length > 2 ? parseInt(parts[2]) : null,
        };
        return rateResult;
    }

    async setRate(rate, range, gyro, packed) {
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
            throw('This device has a maximum rate of 1600Hz.')
        }
        if (!this.hasGyro && packed && parseFloat(rate) < 12) {
            throw('This device has a minimum rate of 12.5Hz in packed mode.')
        }
        if (this.hasGyro && gyro && parseFloat(rate) < 25) {
            throw('This device has a minimum rate of 25Hz with the gyroscope enabled.')
        }
				
        switch (parseInt(range))
        {
            case 16: value |= 0x00; break;
            case  8: value |= 0x40; break;
            case  4: value |= 0x80; break;
            case  2: value |= 0xC0; break;
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
        if (parts[1] != Math.floor(rate)) {
            throw `RATE frequency unexpected: was ${parts[1]}, expected ${Math.floor(rate)}`;
        }
        if (gyroRange && parts[2] != gyroRange) {
            throw `RATE gyro range unexpected: was ${parts[2]}, expected ${gyroRange}`;
        }
    }

    async getStatus() {
        const status = {
            ftl: null,
            restart: null,
            nandid: null,
        };
        const command = new Command(`\r\nSTATUS\r\nECHO\r\n`, 'ECHO=', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        for (let response of result.lines) {
            if (response.startsWith('FTL=')) {
                status.ftl = response.substring(response.indexOf('=') + 1);
            }
            else if (response.startsWith('RESTART=')) {
                status.restart = response.substring(response.indexOf('=') + 1);
            }
            else if (response.startsWith('NANDID=')) {
                status.nandid = response.substring(response.indexOf('=') + 1);
            }
        }
        return status;
    }

    async getLog() {
        const log = [];
        const command = new Command(`\r\nLOG\r\n`, 'LOG,0', 2000);
        console.log('>>> ' + command.output);
        const result = await this.exec(command);
        for (let response of result.lines) {
            const parts = response.split(',');
            // LOG,14,0x0204,2021/01/20,12:34:56,NOT_STARTED_AFTER_INTERVAL
            // LOG,7,0x0209,2021/02/21,13:40:57,NOT_STARTED_WAIT_USB
            // LOG,0,0x0209,2022/03/22,14:45:58,NOT_STARTED_WAIT_BATTERY
            if (parts[0] != 'LOG') continue;
            const index = parseInt(parts[1]);
            const entry = {
                index,
                time: this.parseDateTime(parts[3] + ' ' + parts[4]),
                code: parts[2], // parseInt()
                status: /[_A-Z]*/.exec(parts[5])[0],    // remove any trailing garbage bytes
            };
            log[index] = entry;
        }
        return log;
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

    async readSector(sectorNumber, arrayBuffer = null, byteOffset = 0, byteLength = null) {
        // "0123: 01 23 45 67  89 ab cd ef  01 23 45 67  89 ab cd ef  testtesttesttest\r\n"
        const bytesPerLine = 16;
        const sectorSize = 512;
        const command = new Command(`\r\nREADL ${sectorNumber}\r\nECHO\r\n`, 'ECHO=', 10000);
        console.log(`>>> READL ${sectorNumber}`);
        //console.log('>>> ' + command.output);
        const result = await this.exec(command, true);
        if (!arrayBuffer) {
            arrayBuffer = new ArrayBuffer(sectorSize);
        }
        if (byteLength === null) {
            byteLength = sectorSize;
        }
        const buffer = new DataView(arrayBuffer, byteOffset, byteLength);
        let currentOffset = 0;
        for (let line of result.lines) {
            if (line.startsWith('READL=')) continue;
            if (line.startsWith('OK')) continue;
            if (line.startsWith('ECHO=')) continue;
            line = line.trim();
            const offsetString = line.split(':', 1)[0];
            const offset = parseInt(offsetString, 16);
            if (offset != currentOffset) {
                throw `Unexpected sector offset ${offset}, expected ${currentOffset}`;
            }
            //const valueString = line.slice(offsetString.length + 1, -bytesPerLine).replace(/\ /g, '');
            const valueString = line.replace(/\ /g, '').slice(offsetString.length + 1, offsetString.length + 1 + 2 * bytesPerLine);
            const byteCount = valueString.length / 2;
            if (byteCount != bytesPerLine) {
                throw `Unexpected sector line length ${valueString.length} -> ${byteCount}, expected ${2 * bytesPerLine} -> ${bytesPerLine}`;
            }
            for (let i = 0; i < byteCount; i++) {
                if (currentOffset < byteLength) {
                    const byte = parseInt(valueString.slice(i * 2, i * 2 + 2), 16);
                    buffer.setUint8(currentOffset, byte);
                } else {
                    console.log('WARNING: Ignoring sector contents beyond end of read extent: ' + currentOffset);
                }
                currentOffset++;
            }
        }
        if (currentOffset != sectorSize) {
            console.dir(result.lines);
            throw `Unexpected sector data of size ${currentOffset}, expected size ${sectorSize}, from ${result.lines.length} lines`;
        }
        // buffer.byteLength // buffer.buffer.byteLength
        return buffer;
    }

    // Current position
    fileTell(filesystem, file) {
        return file.sectorWithinFile * filesystem.sectorSize + file.offsetWithinSector;
    }

    // Seek to start
    fileReset(filesystem, file) {
        file.currentCluster = file.dataFirstCluster;
        file.currentSectorWithinFile = 0;
        file.offsetWithinSector = 0;
        file.currentSectorBuffer = null;
    }

    // Seek to offset
    async fileSeek(filesystem, file, offset) {
        //console.log('READ-FILE: Seeking @' + offset);

        // Seek within current sector does nothing
        const seekSector = Math.floor(offset / filesystem.sectorSize);
        if (seekSector == file.currentSectorWithinFile) {
            //console.log('READ-FILE: seeking within current sector');
            return true;
        }

        // Otherwise, sector will be changing
        //console.log('READ-FILE: seeking outside current sector');
        file.currentSectorBuffer = null;

        // Determine current and new cluster indexes
        let currentClusterIndex = Math.floor(file.currentSectorWithinFile / filesystem.sectorsPerCluster);
        const newClusterIndex = Math.floor(seekSector / filesystem.sectorsPerCluster);

        // If seek before the current-cluster, start at beginning of the chain
        if (newClusterIndex < currentClusterIndex) {
            //console.log('READ-FILE: seeking before current cluster, starting at beginning of chain');
            currentClusterIndex = 0;
            file.currentCluster = file.dataFirstCluster;
        }

        //if (newClusterIndex == currentClusterIndex) console.log('READ-FILE: seeking within current cluster');

        // Follow chain from current cluster until we reach the required cluster index
        while (currentClusterIndex != newClusterIndex) {
            let newClusterIndex = null;
            const entriesPerCluster = filesystem.sectorSize * 8 / filesystem.type;
            const page = Math.floor(file.currentCluster / entriesPerCluster);
            if (!filesystem.allocationTable) {
                //console.log('READ-FILE: creating new allocation table');
                filesystem.allocationTable = [];
            }
            //console.log('READ-FILE: Requesting FAT page ' + page);
            if (!filesystem.allocationTable[page]) {
                const sector = filesystem.firstFatSector + page;
                console.log('READ-FILE: Cache miss, reading FAT page ' + page + ' at sector ' + sector);
                const pageData = await this.readSector(sector);
                filesystem.allocationTable[page] = pageData;
            }
            const clusterOffset = file.currentCluster % entriesPerCluster;
            if (filesystem.type == 12) {
                throw 'FAT12 not supported';
            } else if (filesystem.type == 16) {
                newClusterIndex = filesystem.allocationTable[page].getUint16(clusterOffset * 2, true);
            } else if (filesystem.type == 32) {
                newClusterIndex = filesystem.allocationTable[page].getUint32(clusterOffset * 4, true);
            } else {
                throw 'Filesystem type not supported: ' + filesystem.type;
            }
            console.log('READ-FILE: seeking after current cluster, following chain: #' + currentClusterIndex + ' ' + file.currentCluster + ' -> ' + newClusterIndex);
            file.currentCluster = newClusterIndex;
            currentClusterIndex++;
        }

        file.currentSectorWithinFile = seekSector;
        file.offsetWithinSector = offset % filesystem.sectorSize;
        //console.log('READ-FILE: seeking complete, sector ' + file.currentSectorWithinFile + ', offset ' + file.offsetWithinSector + ', clusterIndex=' + currentClusterIndex);

        return true;
    }

    async fileRead(filesystem, file, maxSize, dataContents, index) {
        //console.log('READ-FILE: @maxSize=' + maxSize + ', current-offset=' + file.offsetWithinSector + ' / ' + filesystem.sectorSize);

        // Ignore empty reads
        if (maxSize <= 0) return 0;

        // Seek if past all of existing sector
        if (file.offsetWithinSector >= filesystem.sectorSize) {
            // Seek to start of next sector
            const newOffset = (file.currentSectorWithinFile + 1) * filesystem.sectorSize;
            await this.fileSeek(filesystem, file, newOffset);
            //console.log('READ-FILE: ...seek result @' + file.currentSectorWithinFile);
        }

        // Read in sector buffer, if not yet read
        if (file.currentSectorBuffer == null) {
            const sector = filesystem.firstSectorOfFileArea + (file.currentCluster - 2) * filesystem.sectorsPerCluster + (file.currentSectorWithinFile % filesystem.sectorsPerCluster);
            file.currentSectorBuffer = new ArrayBuffer(filesystem.sectorSize);
            //console.log('READ-SECTOR: ' + sector);
            await this.readSector(sector, file.currentSectorBuffer, 0, filesystem.sectorSize);
        }

        if (maxSize > filesystem.sectorSize - file.offsetWithinSector) {
            maxSize = filesystem.sectorSize - file.offsetWithinSector;
        }
        //console.log('READ-FILE: Sub-reading @offset=' + file.offsetWithinSector + ' @index=' + index + ' sector #' + filesystem.firstSectorOfFileArea + (file.currentCluster - 2) * filesystem.sectorsPerCluster + (file.currentSectorWithinFile % filesystem.sectorsPerCluster) + ' maxSize=' + maxSize +'...');

        const bufferIn = new DataView(file.currentSectorBuffer, file.offsetWithinSector, maxSize);
        const bufferOut = new DataView(dataContents, index, maxSize);
        for (let i = 0; i < maxSize; i++) {
            const value = bufferIn.getUint8(i);
            bufferOut.setUint8(i, value);
        }
        file.offsetWithinSector += maxSize;

        //console.log('READ-FILE: Sub-reading finished @offset=' + file.offsetWithinSector);

        return maxSize;
    }

    async findFileEntry(filesystem, filename) {
        // Read first sector of the root filesystem
        if (!filesystem.rootSector) {
            filesystem.rootSector = await this.readSector(filesystem.rootSectorNumber);
        }{}

        // Entry is space-padded 8.3 filename with no `.` separator
        const parts = filename.split('.'); 
        const ext = ((parts.length <= 1) ? '' : parts.pop()).trim().toUpperCase().slice(0, 3).padEnd(3, ' '); 
        const fname = parts.join('').trim().toUpperCase().replace(/ /g, '').slice(0, 8).padEnd(8, ' '); 
        const entry = fname + ext;

        // Scan first sector of root directory (file must be within the first 16 entries of the root directory)
        const file = {};
        file.filename = filename;
        file.entry = entry;
        file.exists = false;
        file.dataLength = null;
        file.dataFirstCluster = null;
        for (let i = 0; i < 16; i++) {
            const offset = 32 * i;
            let match = true;
            for (let o = 0; o < entry.length; o++) {
                if (filesystem.rootSector.getUint8(offset + o) != entry.charCodeAt(o)) {
                    match = false;
                    break;
                }
            }
            if (match) {
                file.exists = true;
                file.dataFirstCluster = filesystem.rootSector.getUint16(offset + 26, true);
                file.dataLength = filesystem.rootSector.getUint32(offset + 28, true);
                break;
            }
        }

        this.fileReset(filesystem, file);
        return file;
    }

    async readFile(filesystem, file, offset, maxSize) {
        if (!file.exists) { return null; }
        if (!await this.fileSeek(filesystem, file, offset)) {
            throw 'Cannot seek to offset: ' + offset;
        }
        if (maxSize === null) { maxSize = file.dataLength - offset; }
        if (maxSize > file.dataLength - offset) { maxSize = file.dataLength - offset; }

        console.log('READ-FILE: @' + offset + '+' + maxSize);

        //console.log('READ-FILE: Maximum read: ' + maxSize + ' / ' + file.dataLength);
        const dataContents = new ArrayBuffer(maxSize);
        let index = 0;
        for (;;) {
            //console.log('READ-FILE: Reading @index=' + index + '...');
            const read = await this.fileRead(filesystem, file, maxSize - index, dataContents, index);
            if (read <= 0) break;
            index += read;
        }
        if (index < maxSize) {
            console.log('READ-FILE WARNING: Short read: ' + index + ' / ' + maxSize);
        }
        return dataContents;
    }
    
    async readFilesystem(readEndOfFile) {
        this.updateState('Reading filesystem - please wait...');
        const filesystem = {};
        // MBR and first partition data
        filesystem.mbrSector = await this.readSector(0);
        if (filesystem.mbrSector.getUint8(510) != 0x55 || filesystem.mbrSector.getUint8(511) != 0xAA) {
            throw 'Invalid MBR signature';
        }
        filesystem.firstSectorNumber = filesystem.mbrSector.getUint32(454, true); // 94
        filesystem.sectorCount = filesystem.mbrSector.getUint32(458, true);
        // FAT16
        filesystem.bootSector = await this.readSector(filesystem.firstSectorNumber);
        filesystem.sectorSize = filesystem.bootSector.getUint16(11, true);   // 512
        if (filesystem.sectorSize != 512) {
            throw 'Invalid sectorSize: ' + filesystem.sectorSize;
        }
        filesystem.sectorsPerCluster = filesystem.bootSector.getUint8(13);   // 32 // 64
        if (filesystem.sectorsPerCluster & (filesystem.sectorsPerCluster - 1)  != 0) {
            throw 'Invalid sectorsPerCluster: ' + filesystem.sectorsPerCluster;
        }
        filesystem.clusterSize = filesystem.sectorsPerCluster * filesystem.sectorSize;   // 16384 // 32768
        if (filesystem.clusterSize & (filesystem.clusterSize - 1)  != 0) {
            throw 'Invalid clusterSize: ' + filesystem.clusterSize;
        }
        filesystem.numReservedSectors = filesystem.bootSector.getUint16(14, true);  // 8
        filesystem.numFATs = filesystem.bootSector.getUint8(16);    // 2
        if (filesystem.numFATs < 1 || filesystem.numFATs > 2) {
            throw 'Invalid numFATs: ' + filesystem.numFATs;
        }
        filesystem.firstFatSector = filesystem.firstSectorNumber + filesystem.numReservedSectors;
        filesystem.numRootDirectoryEntries = filesystem.bootSector.getUint16(17, true); // 512
        if (filesystem.numRootDirectoryEntries == 0) {
            throw 'Invalid numRootDirectoryEntries: ' + filesystem.numRootDirectoryEntries;
        }
        filesystem.sectorsPerFAT = filesystem.bootSector.getUint16(22, true); // 61
        filesystem.rootSectorNumber = filesystem.firstSectorNumber + filesystem.numReservedSectors + (filesystem.numFATs * filesystem.sectorsPerFAT); // 224

        // First sector of the file area
        filesystem.firstSectorOfFileArea = filesystem.rootSectorNumber + Math.floor((32 * filesystem.numRootDirectoryEntries) / 512);

        filesystem.sectorCapacity = filesystem.sectorCount - filesystem.firstSectorNumber;
        filesystem.clusterCapacity = Math.ceil(filesystem.sectorCapacity / filesystem.sectorsPerCluster);
        if (filesystem.clusterCapacity < 4085) {
            filesystem.type = 12;
        } else if (filesystem.clusterCapacity < 65525) {
            filesystem.type = 16;
        } else {
            filesystem.type = 32;
        }
        if (filesystem.type == 32) {
            // TODO: Verify this?
            filesystem.rootSectorNumber = filesystem.firstSectorOfFileArea;
        }
        console.log('Filesystem: ' + filesystem.type + '-bit, ' + filesystem.sectorCapacity + ' sectors, ' + filesystem.clusterCapacity + ' clusters, ' + filesystem.sectorsPerCluster + ' sectors per cluster, ' + filesystem.clusterSize + ' bytes per cluster, ' + filesystem.numRootDirectoryEntries + ' root directory entries, ' + filesystem.firstSectorOfFileArea + ' first sector of file area, ' + filesystem.rootSectorNumber + ' first sector of root directory');

        // Read the first few sectors of the data file
        filesystem.fileEntry = await this.findFileEntry(filesystem, 'CWA-DATA.CWA');

        // Read the first few sectors of the file
        filesystem.fileEntry.dataContents = await this.readFile(filesystem, filesystem.fileEntry, 0, 3 * 512);
        filesystem.fileEntry.readLength = filesystem.fileEntry.dataContents.byteLength;

        if (readEndOfFile && filesystem.fileEntry.dataLength >= 3 * 512) {
            // Read the last sector of the file
            filesystem.fileEntry.lastDataContents = await this.readFile(filesystem, filesystem.fileEntry, filesystem.fileEntry.dataLength - 512, 512);
        }
   
        return filesystem;
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
            command = new Command(`\r\nFORMAT WC\r\n`, 'COMMIT', 15000);
        } else if (wipe === false) {
            this.updateState('Configuring: Erasing and committing');
            command = new Command(`\r\nFORMAT QC\r\n`, 'COMMIT', 12000);
        } else if (wipe === null) {
            this.updateState('Configuring: Committing');
            command = new Command(`\r\nCommit\r\n`, 'COMMIT', 8000);
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

        const now = new Date(); //localTime(new Date());

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
                resetDeviceId: null,
                minbattery: null,
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
            if (this.status.battery.percent < config.minbattery) {
                throw `ERROR: Device battery level too low: ${this.status.battery.percent}% (required ${config.minbattery}%).`
            }

            if (config.noData) {
                const filesystem = await this.tryAndRetry(() => this.readFilesystem(false));
                console.log('FILESYSTEM=' + JSON.stringify(filesystem));
                if (filesystem.fileEntry && filesystem.fileEntry.dataLength && filesystem.fileEntry.dataLength > 1024) {
                    throw 'ERROR: Device has data on it.'
                }
            }

            if (!config.time) {
                config.time = new Date();
            }

            if (config.resetDeviceId) {
                this.setId(config.resetDeviceId);
            }
            await this.tryAndRetry(() => this.setTime(config.time));
            await this.tryAndRetry(() => this.setRate(config.rate, config.range, config.gyro, true));
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
                timeDevice: localTimeString(config.time, 'S'),
                deviceId: this.status.id.deviceId,
                battery: battery.percent,
                // Config
                start: config.start,
                startDevice: localTimeString(config.start, 'S'),
                stop: config.stop,
                stopDevice: localTimeString(config.stop, 'S'),
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

    async runDownload(progressCallback) {
        const started = Date.now();
        let lastCallback = null;
        console.log('DOWNLOAD: Start...');
        if (this.device.isBusy()) {
            this.updateState(null, 'Device busy');
            throw('ERROR: Device is busy');
        }
        try {
            await this.tryAndRetry(() => this.open());

            if (!this.diagnostic) this.diagnostic = {};
            if (!this.diagnostic.filesystem) this.diagnostic.filesystem = await this.readFilesystem(false);
    
            if (!this.diagnostic.filesystem.fileEntry) {
                throw 'Cannot find file.'
            }
    
            const maxLen = this.diagnostic.filesystem.fileEntry.dataLength;
            let filename = this.diagnostic.filesystem.fileEntry.filename;
            filename = filename.replace('.CWA', '-' + this.status.id.deviceId + '.cwa');
    
            const result = await download(filename, maxLen, async (writer) => {
                if (!writer) throw new Error('Writer is aborted - callback 1');
                if (!writer.written) { writer.written = 0; }
                const chunkSize = 16 * 512; // 8192
                const dataRead = await this.readFile(this.diagnostic.filesystem, this.diagnostic.filesystem.fileEntry, writer.written, chunkSize);

                if (!writer) throw new Error('Writer is aborted - callback 2');
                console.log('DOWNLOAD: READ: ' + dataRead.byteLength );

                //const bytes = new TextEncoder().encode('!');    // Uint8Array(1)  .buffer : ArrayBuffer(1)
                const bytes = new Uint8Array(dataRead);
                await writer.write(bytes);

                if (!writer) throw new Error('Writer is aborted - callback 3');
                writer.written += bytes.byteLength;
                const unfinished =  writer.written < writer.fileSize;

                const now = Date.now();
                if (lastCallback === null || now - lastCallback >= 1000 || !unfinished) {
                    const elapsed =  (now - started) / 1000;
                    const written = writer.written;
                    const proportion = (maxLen > 0) ? (written / maxLen) : 1;
                    const bytesPerSecond = (elapsed > 2) ? (written / elapsed) : 0;
                    const estimatedRemaining = (bytesPerSecond > 0) ? (maxLen - written) / bytesPerSecond : null;

                    const callbackStatus = {
                        elapsed,
                        written,
                        total: maxLen,
                        proportion,
                        complete: unfinished,
                        bytesPerSecond,
                        estimatedRemaining,
                    };
                    if (progressCallback) {
                        progressCallback(callbackStatus);
                    }
                    lastCallback = now;
                }

                return unfinished;
            });
            console.log('DOWNLOAD: result=' + result);
debugger;

        } catch (e) {
            if (e.error) {
                this.updateState(null, `Error running diagnostic: ${e.error}`);
                console.log('ERROR: Problem during diagnostic: ' + e.error);
            } else {
                this.updateState(null, `Error running diagnostic: ${e}`);
                console.log('ERROR: Problem during diagnostic: ' + e);
            }
            throw e;
        } finally {
            await this.close();
        }

    }

    async runReset(deviceId) {
        //DEVICE=12345|TIME 2020-01-01 00:00:00|FORMAT QC|LED 5
        let resetConfig = {
            time: new Date(),
            session: 0,
            rate: 100,
            range: 8,
            gyro: 0,
            start: -1,
            stop: 0,
            metadata: '',
            maxSamples: 0,
            debug: 0,
            wipe: true,
            minbattery: 0,
            noData: false,
        }

        if (deviceId) {
            resetConfig.resetDeviceId = deviceId;
        }

        this.configure(resetConfig);
    }

    async runDiagnostic() {
        if (this.device.isBusy()) {
            this.updateState(null, 'Device busy');
            throw('ERROR: Device is busy');
        }
        try {
            this.updateState('Running diagnostic...');

            await this.tryAndRetry(() => this.open());

            this.diagnostic = {};
            this.diagnostic.errors = [];
            this.diagnostic.time = new Date();

            // Existing info from status:
            this.diagnostic.id = this.status.id; // .deviceType .deviceId .firmwareVersion
            this.diagnostic.battery = this.status.battery; // .voltage .percent .charging .time
            this.diagnostic.start = this.status.start;
            this.diagnostic.stop = this.status.stop;

            // Additional information
            try {
                this.diagnostic.rate = await this.getRate();
                this.diagnostic.deviceTime = await this.getTime();
                this.diagnostic.sessionId = await this.getSession();
                this.diagnostic.maxSamples = await this.getMaxSamples();
                this.diagnostic.status = await this.getStatus();
                this.diagnostic.log = await this.getLog();
            } catch (e) {
                this.diagnostic.errors.push('Problem while getting additional information: ' + JSON.stringify(e));
            }

            // Read filesystem
            try {
                const readEndOfFile = true;
                this.diagnostic.filesystem = await this.readFilesystem(readEndOfFile);
            } catch (e) {
                this.diagnostic.errors.push('Problem while getting filesystem information: ' + JSON.stringify(e));
            }

            // Raw sectors
            this.diagnostic.sectorDump = {};
            if (this.diagnostic.filesystem) {
                if (this.diagnostic.filesystem.mbrSector) this.diagnostic.sectorDump.mbrSector = dump(this.diagnostic.filesystem.mbrSector);
                if (this.diagnostic.filesystem.bootSector) this.diagnostic.sectorDump.bootSector = dump(this.diagnostic.filesystem.bootSector);
                if (this.diagnostic.filesystem.rootSector) this.diagnostic.sectorDump.rootSector = dump(this.diagnostic.filesystem.rootSector);
                if (this.diagnostic.filesystem.allocationTable && this.diagnostic.filesystem.allocationTable[0]) this.diagnostic.sectorDump.allocationTable0 = dump(this.diagnostic.filesystem.allocationTable[0]);
            }
            
            // Parse initial sector
            if (this.diagnostic.filesystem && this.diagnostic.filesystem.fileEntry && this.diagnostic.filesystem.fileEntry.dataLength > 0 && this.diagnostic.filesystem.fileEntry.dataContents) {
                let fileData = null;
                let fileDataLast = null;
                try {
                    this.diagnostic.file = {
                        filename: this.diagnostic.filesystem.fileEntry.filename,
                        length: this.diagnostic.filesystem.fileEntry.dataLength,
                        source: 'serial',
                    };
                    fileData = this.diagnostic.filesystem.fileEntry.dataContents;
                    fileDataLast = this.diagnostic.filesystem.fileEntry.lastDataContents;

                    this.diagnostic.sectorDump.dataContents = dump(this.diagnostic.filesystem.fileEntry.dataContents);
                    if (fileDataLast) {
                        this.diagnostic.sectorDump.lastDataContents = dump(this.diagnostic.filesystem.fileEntry.lastDataContents);
                    }
                } catch (e) {
                    this.diagnostic.errors.push('Problem while reading data file: ' + JSON.stringify(e));
                }

                // First sector
                if (fileData && this.diagnostic.filesystem.fileEntry.dataLength >= 1 * 512) {
                    try {
                        this.diagnostic.header = parseHeader(new DataView(fileData, 0 * 512, 512));
                    } catch (e) {
                        this.diagnostic.errors.push('Problem while parsing file header: ' + JSON.stringify(e));
                    }
                }

                // Second sector - reserved header

                // Third sector - first data sector
                if (fileData && this.diagnostic.filesystem.fileEntry.dataLength >= 3 * 512) {
                    try {
                        this.diagnostic.first = parseData(new DataView(fileData, 2 * 512, 512));
                    } catch (e) {
                        this.diagnostic.errors.push('Problem while parsing file data (first): ' + JSON.stringify(e));
                    }
                }

                // Last sector - first data sector
                if (fileDataLast && this.diagnostic.filesystem.fileEntry.dataLength >= 1 * 512) {
                    try {
                        this.diagnostic.last = parseData(new DataView(fileDataLast, 0, 512));
                    } catch (e) {
                        this.diagnostic.errors.push('Problem while parsing file data (last): ' + JSON.stringify(e));
                    }
                }
            }

            // Finish
            this.recalculateRecordingStatus();  // updateState

            // Clean up
            if (this.diagnostic.filesystem && this.diagnostic.filesystem.allocationTable) {
                delete this.diagnostic.filesystem.allocationTable;
            }

            return this.diagnostic;
        } catch (e) {
            if (e.error) {
                this.updateState(null, `Error running diagnostic: ${e.error}`);
                console.log('ERROR: Problem during diagnostic: ' + e.error);
            } else {
                this.updateState(null, `Error running diagnostic: ${e}`);
                console.log('ERROR: Problem during diagnostic: ' + e);
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

