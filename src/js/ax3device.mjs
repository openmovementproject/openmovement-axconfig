import { sleep, localTime } from './util.mjs';
const encoder = new TextEncoder('windows-1252');
const decoder = new TextDecoder('windows-1252');

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

function cdcFromConfiguration(configuration) {
    // Find the control and data interfaces
    let interfaceControl = null;
    let interfaceData = null;
    for (let inter of configuration.interfaces) {
        if (inter.alternates[0].interfaceClass == Ax3Device.USB_CLASS_COMM) {
            interfaceControl = inter.interfaceNumber;
        } else if (inter.alternates[0].interfaceClass == Ax3Device.USB_CLASS_CDC_DATA) {
            interfaceData = inter.interfaceNumber;
        }
    }
    if (interfaceControl === null) {
        console.log('WARNING: CDC control interface not found in configuration ' + configuration.configurationValue);
        return null;
    }
    if (interfaceData === null) {
        console.log('NOTE: CDC data interface not found in configuration ' + configuration.configurationValue + ' -- will continue and assume malformed CDC using a single interface');
        interfaceData = interfaceControl;
    }

    // Find the control endpoint
    let endpointControl = null;
    for (let endpoint of configuration.interfaces[interfaceControl].alternates[0].endpoints) {
        if (endpoint.direction === 'in' && endpoint.type === 'interrupt') {
            endpointControl = endpoint.endpointNumber;  // not the index
        } else {
            //console.log('NOTE: Control endpoint ignored ' + endpoint.endpointNumber);
        }
    }
    if (endpointControl === null) {
        console.log('WARNING: CDC control endpoint not found in configuration ' + configuration.configurationValue);
        return null;
    }

    // Find the data read/write endpoints
    let endpointRead = null;
    let endpointWrite = null;
    for (let endpoint of configuration.interfaces[interfaceData].alternates[0].endpoints) {
        if (interfaceData == interfaceControl && endpoint.endpointNumber == endpointControl) {
            continue; // do not consider a control endpoint (on a shared data/control interface) as a data endpoint candidate
        } else if (endpoint.direction === 'in' && endpoint.type === 'bulk') {
            endpointRead = endpoint.endpointNumber;   // not the index; endpoint.packetSize == 64
        } else if (endpoint.direction === 'out' && endpoint.type === 'bulk') {
            endpointWrite = endpoint.endpointNumber;  // not the index; endpoint.packetSize == 64
        } else {
            console.log('NOTE: Data endpoint ignored ' + endpoint.endpointNumber);
        }
    }
    if (endpointRead === null || endpointWrite === null) {
        console.log('WARNING: CDC data read/write endpoints not found in configuration ' + configuration.configurationValue);
        return null;
    }

    return {
        configurationValue: configuration.configurationValue,
        control: {
            interface: interfaceControl,
            endpoint: endpointControl,
        },
        data: {
            interface: interfaceData,
            endpointRead: endpointRead,
            endpointWrite: endpointWrite,
        },
    };
}



function genericFromConfiguration(configuration) {
    // Find the control and data interfaces
    let interfaceData = null;
    for (let inter of configuration.interfaces) {
        if (inter.alternates[0].interfaceClass == 0xff) {
            interfaceData = inter.interfaceNumber;
        }
    }
    if (interfaceData === null) {
        //console.log('NOTE: Generic data interface not found in configuration (will try to use CDC) ' + configuration.configurationValue);
        return null;
    }

    // Find the data read/write endpoints
    let endpointRead = null;
    let endpointWrite = null;
    for (let endpoint of configuration.interfaces[interfaceData].alternates[0].endpoints) {
        if (endpoint.direction === 'in' && endpoint.type === 'bulk') {
            endpointRead = endpoint.endpointNumber;   // not the index; endpoint.packetSize == 64
        }
        if (endpoint.direction === 'out' && endpoint.type === 'bulk') {
            endpointWrite = endpoint.endpointNumber;  // not the index; endpoint.packetSize == 64
        }
    }
    if (endpointRead === null || endpointWrite === null) {
        console.log('WARNING: Generic data read/write endpoints not found in configuration ' + configuration.configurationValue);
        return null;
    }

    return {
        configurationValue: configuration.configurationValue,
        data: {
            interface: interfaceData,
            endpointRead: endpointRead,
            endpointWrite: endpointWrite,
        },
    };
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
            this.error = e;
            this.reject(this);    
        } else {
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

        this.io = null;

        this.commandQueue = [];
        this.currentCommand = null;
        this.currentTimeout = null;
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
        console.log('exec()');
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
                console.log('execNext(): write: ' + this.currentCommand.command.output);
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
                    console.log('execNext(): timeout');
                    this.commandComplete('Timeout before read');
                }
                console.log('execNext(): read');
                data = await this.read();
            } catch (e) {
                console.log('execNext(): read exception: ' + e);
                this.commandComplete(e);
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
        // Invoke again shortly
        this.nextTick = setTimeout(async () => {
            console.log('execNext(): ...');
            await this.execNext();
            console.log('execNext(): ... done');
        }, 0);
        console.log('execNext(): end');
    }

    async timeout() {
        console.log('timeout(): ...');
        this.currentTimeout = null;
        if (this.currentCommand) {
            console.log('timeout(): ...cancel...');
            await this.cancelRead();
            commandComplete('Timeout');
        } else {
            console.log('timeout(): no current command');
        }
        console.log('timeout(): ...done');
    }

    commandComplete(e = null) {
        if (e !== null) {
            console.log('commandComplete(): FAILED ' + e + ' -- ' + this.currentCommand.command.output);
        } else {
            console.log('commandComplete(): SUCCESS -- ' + this.currentCommand.command.output);
        }
        if (this.currentTimeout) {
            clearTimeout(this.currentTimeout);
            this.currentTimeout = null;
        }
        if (this.currentCommand) {
            this.currentCommand.complete(e);
        }
        this.currentCommand = null;
    }
    

    async open() {
        this.receiveBuffer = '';
        try {
            await this.device.open();
        } catch (e) {
            console.log('ERROR: Problem opening device: ' + e, e.name + ' -- ' + e.message);
            if (location.protocol == 'file:') {
                console.log('NOTE: Hosting from a file: protocol may cause this. Try serving over HTTP.');
            }
            if (e.name == 'SecurityError') {
                if (navigator.appVersion.indexOf('(Windows') >= 0) {
                    console.log('NOTE: The "new" Windows WebUSB back-end may have this issue.');
                }
            }
            throw e;
        }
        
        console.log('Determine I/O...');
        this.io = null;
        //console.log('CONFIGURATIONS: ', this.device.configurations);
        for (let configuration of this.device.configurations) {
            this.io = genericFromConfiguration(configuration);
            if (this.io !== null) { break; }
            this.io = cdcFromConfiguration(configuration);
            if (this.io !== null) { break; }
        }
        if (this.io === null) {
            console.log('ERROR: No matching configuration found.');
            throw 'No matching configuration found';
        }
        console.log('IO FOUND, selecting configuration: ' + JSON.stringify(this.io));
        try {
            await this.device.selectConfiguration(this.io.configurationValue);
        } catch (e) {
            console.log('ERROR: Problem selecting configuration: ' + this.io.configurationValue + ' -- ' + e);
            throw e;
        }
        console.log('...claiming interfaces...');
        /*
        try {
            await this.device.claimInterface(io.control.interface);
        } catch (e) {
            console.log('WARNING: Problem claiming control interface (but not currently used): ' + io.control.interface + ' -- ' + e);
        }
        */
        try {
            await this.device.claimInterface(this.io.data.interface);
        } catch (e) {
            console.log('ERROR: Problem claiming data interface (could it already be claimed by a driver?): ' + this.io.data.interface + ' -- ' + e);
            throw e;
        }
        console.log('...opened');
    }


    async close() {
        try {
            //await this.device.releaseInterface(this.io.control.interface);
            await this.device.releaseInterface(this.io.data.interface);
        } catch (e) {
            //console.log('WARNING: Problem releasing control and data interfaces: ', this.io.control.interface, this.io.data.interface, e);
            console.log('WARNING: Problem releasing data interface: ' + this.io.data.interface + ' -- ' + e);
        } finally {
            try {
                console.log('...close...');
                await this.device.close();
                console.log('...closed');
                return true;
            } catch (e) {
                //console.log('WARNING: Problem releasing control and data interfaces: ', this.io.control.interface, this.io.data.interface, e);
                console.log('WARNING: Problem closing device -- ' + e);
                return false;
            }
        }
    }


    async write(message) {
        console.log('SEND: ' + message);
        let outBuffer = encoder.encode(message);
        console.log('===: ' + outBuffer);
        try {
            await this.device.transferOut(this.io.data.endpointWrite, outBuffer);
        } catch (e) {
            console.log('WARNING: Problem writing data: ' + this.io.data.endpointWrite + ' -- ' + outBuffer + ' -- ' + e);
            throw e;
        }
    }


    async read() {
        console.log('Read...');
        let reply = null;
        try {
            console.log(`...transferIn(${this.io.data.endpointRead})`);
            let result = await this.device.transferIn(this.io.data.endpointRead, 64);
            console.log(`...transferIn() - done (${result.status}): ` + result);

            if (result.status === 'stall') {
                console.log('Endpoint stalled. Clearing.');
                await this.device.clearHalt('in', this.io.data.endpointRead);
            }

            if (result.status === 'ok') {
                if (result.data && result.data.byteLength > 0) {
                    // Clean the data to be printable ASCII only
                    let replacements = 0;
                    for (let i = 0; i < result.data.byteLength; i++) {
                        let v = result.data.getUint8();
                        if (v >= 128 || (v < 32 && v != '\r' && v != '\n')) {
                            buffer.setUint8(32);
                            replacements++;
                        } 
                    }
                    if (replacements > 0) {
                        console.log(`NOTE: Replaced ${replacements} of ${result.data.byteLength} bytes.`);
                    }
                    reply = decoder.decode(result.data);   
                } else {
                    console.log('WARNING: Transfer was ok but no data: ' + result.data.byteLength);
                }
            } else {
                console.log('WARNING: Transfer result: ' + result.status);
            }
        } catch (e) {
            console.log('WARNING: Problem reading data: ' + this.io.data.endpointRead + ' -- ' + e);
            return null;
        }
        console.log('RECV: ' + (reply === null ? '<null>' : reply.replace(/[\r\n]/g, '|')));

        return reply;
    }


    // Experimental way to try to break an existing read
    async cancelRead() {
        try {
            console.log('cancelRead() - ' + this.io.data.endpointRead);
            await this.device.clearHalt('in', this.io.data.endpointRead);
            console.log('cancelRead() - done');
            return true;
        } catch (e) {
            console.log('WARNING: Problem cancelling read: ' + this.io.data.endpointRead + ' -- ' + e);
            return false;
        }
    }


    isBusy() {
        return this.device.opened;
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
        return {
            deviceType: parts[0],
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
        this.updateState('Setting time');
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
        this.updateState('Setting session ID');
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
        this.updateState('Setting max samples');
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
        this.updateState('Setting start');
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
        this.updateState('Setting stop');
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

    async setRate(rate, range) {
        this.updateState('Setting rate');
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
				
        switch (parseInt(range))
        {
            case 16:   value |= 0x00; break;
            case  8:   value |= 0x40; break;
            case  4:   value |= 0x80; break;
            case  2:   value |= 0xC0; break;
            default: throw('Invalid accelerometer sensitivity.');
        }

        const command = new Command(`\r\nRATE ${value}\r\n`, 'RATE=', 2000);
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
    }

    async setDebug(debugCode) {
        let debugValue = (debugCode === true) ? 3 : +debugCode;     // true = debug code 3; false = debug code 0
        this.updateState('Setting debug status');
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
            this.updateState(`Setting metadata (${i + 1} / ${count})`);
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

            const command = new Command(`\r\n${cmdOut}\r\n`, cmdIn, 2000);
            console.log('>>> ' + command.output);
            const result = await this.exec(command);
            const response = result.lastLine();
            console.log('<<< ' + response);
            const returnValue = response.substring(response.indexOf('=') + 1);
            if (returnValue.trim() != strip.trim()) {
                throw `${cmdIn} unexpected value, received "${returnValue.trim()}", expected "${strip.trim()}"`;
            }
        }
    }

    async commit(wipe) {
        let command;
        if (wipe === true) {
            this.updateState('Wipe and commit');
            command = new Command(`\r\nFORMAT WC\r\n`, 'COMMIT', 10000);
        } else if (wipe === false) {
            this.updateState('Erase and commit');
            command = new Command(`\r\nFORMAT QC\r\n`, 'COMMIT', 8000);
        } else if (wipe === null) {
            this.updateState('Committing');
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
        if (this.isBusy()) {
            this.updateState(null, 'Device busy');
            throw('ERROR: Device is busy');
        }
        try {
            this.updateState('Querying status');

            await this.tryAndRetry(() => this.open());

            if (this.status.id === null || this.status.id.deviceId === null) {
                this.status.id = await this.tryAndRetry(() => this.getId());  // id.deviceId
                if (this.status.id.deviceId != this.serial) {
                    throw `ERROR: Device id mismatch: reported ID=${this.status.id.deviceId} but USB serial number was ${this.serial}.`
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
        if (this.isBusy()) {
            this.updateState(null, 'Device busy');
            throw('ERROR: Device is busy');
        }

        try {
            this.updateState('Configuring...');
            await this.tryAndRetry(() => this.open());

            const config = Object.assign({
                minBattery: null,
                configLed: Ax3Device.LED_BLUE,
                time: null,
                sessionId: 0,
                maxSamples: 0,
                accelRate: 100,
                accelRange: 8,
                hibernate: -1,  // sleep forever
                stop: 0,        // stop always
                metadata: '',
                led: Ax3Device.LED_MAGENTA,
                wipe: true,     // true=wipe first, false=rewrite filesystem, null=commit over
                noData: false,
                debug: false,
            }, newConfig);

            console.log('ID=' + JSON.stringify(this.status.id));
            if (this.status.id.deviceId != this.serial) {
                throw `ERROR: Device id mismatch (was status updated first?): reported ID=${this.status.id.deviceId} but USB serial number was ${this.serial}.`
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
            await this.tryAndRetry(() => this.setSession(config.sessionId));
            await this.tryAndRetry(() => this.setMaxSamples(config.maxSamples));
            await this.tryAndRetry(() => this.setDebug(config.debug ? 3 : 0));
            await this.tryAndRetry(() => this.setRate(config.accelRate, config.accelRange));
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
                sessionId: config.sessionId,
                accelRate: config.accelRate,
                accelRange: config.accelRange,
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
Ax3Device.USB_CLASS_COMM = 0x02;        // interface for CDC control
Ax3Device.USB_CLASS_CDC_DATA = 0x0a;    // interface for CDC data

// LED Colours              // 0bRGB
Ax3Device.LED_OFF = 0;      // 0b000
Ax3Device.LED_BLUE = 1;     // 0b001
Ax3Device.LED_GREEN = 2;    // 0b010
Ax3Device.LED_CYAN = 3;     // 0b011
Ax3Device.LED_RED = 4;      // 0b100
Ax3Device.LED_MAGENTA = 5;  // 0b101
Ax3Device.LED_YELLOW = 6;   // 0b110
Ax3Device.LED_WHITE = 7;    // 0b111

