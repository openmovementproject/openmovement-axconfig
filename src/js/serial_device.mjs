import { sleep } from './util.mjs';

export default class SerialDevice {


    constructor(port) {
        console.dir(port);
        this.port = port;
        this.type = 'serial';
        console.log('PORT: ' + JSON.stringify(this.port));
        console.log('PORT properties: ' + JSON.stringify(Object.getOwnPropertyNames(this.port)));
        this.portInfo = {};
        if (this.port.getInfo) {
            this.portInfo = this.port.getInfo();
        } else {
            console.log('WARNING: No .portInfo()');
        }
        console.log('PORT INFO: ' + JSON.stringify(this.portInfo));
        // .locationId	
        this.productName = this.portInfo.product;   // .productId
        this.manufacturerName = this.portInfo.manufacturer; // .vendorId .vendor
        this.serialNumber = this.portInfo.serialNumber;

        this.openFlag = false;
        this.unopenable = false;
        this.buffer = [];
    }


    internalStartRead() {
        try {
            this.reader.read().then(this.internalRead.bind(this))
        } catch (e) {
            console.log("ERROR: Problem in reader while starting read -- reader may be broken now: " + e);
        }
    }

    internalRead({ done, value }) {
        try {
console.log('*** ' + JSON.stringify({value, done}))
            if (value !== null && typeof value !== 'undefined' && value.length > 0) {
console.log('<<< [' + this.buffer.length + '] ' + value);
                this.buffer.push(value);
            }
            if (done) {
                console.log("READER: Stream end");
                this.reader.releaseLock();
                this.reader = null;
                // End read loop
                return;
            }
        } catch (e) {
            console.log("ERROR: Problem in reader while completing read -- reader may be broken now: " + e);
        }
        // Continue read loop (clean callstack)
        setTimeout(this.internalStartRead.bind(this), 0);
    }


    async open() {
        try {
            if (this.openFlag) { throw "Port already open"; }

            const options = {
                baudrate: 9600,
            }
            await this.port.open(options);

            this.encoder = new TextEncoderStream();
            this.outputDone = this.encoder.readable.pipeTo(this.port.writable);
            this.outputStream = this.encoder.writable;
            this.writer = null;

            this.decoder = new TextDecoderStream();
            this.inputDone = this.port.readable.pipeTo(this.decoder.writable);
            this.inputStream = this.decoder.readable;
            this.reader = this.inputStream.getReader();

            // Start read loop
            this.internalStartRead();

            this.openFlag = true;
            this.unopenable = false;
        } catch (e) {
            this.unopenable = true;
            console.log('ERROR: Problem opening serial device: ' + e, e.name + ' -- ' + e.message);
            /*
            if (location.protocol == 'file:') {
                console.log('NOTE: Hosting from a file: protocol may cause this. Try serving over HTTP.');
            }
            */
            throw e;
        }
        console.log('...serial opened');
    }


    async close() {
        try {
            console.log('CLOSE: reader=' + (this.reader ? JSON.stringify(this.reader) : 'n/a'));
            try { if (this.reader) await this.reader.cancel(); } catch (e) { console.log('ERROR: Problem cancelling reader: ' + e); }
            try { await this.inputDone.catch(() => {}) } catch (e) { console.log('ERROR: Problem waiting for inputDone: ' + e); }
            if (this.port.readable.locked) {
                console.log('!!! UNEXPECTED: Port readable was still locked -- expected to be released when stream flagged done.');
                if (this.reader) this.reader.releaseLock();
            }
            this.reader = null;
            try {
                await this.outputStream.getWriter().close();
                this.outputStream = null;
            }
            catch (e) { console.log('ERROR: Problem closing writer: ' + e); }
            try {
                await this.outputDone;
                this.outputDone = null;
            }
            catch (e) { console.log('ERROR: Problem waiting for outputDone: ' + e); }
        } catch (e) {
            console.log('WARNING: Problem cancelling/unlocking: ' + e);
        } finally {
            try {
                console.log('...close...');
                if (this.port.writable.locked) {
                    console.error("WARNING: Port writable is still locked (will not close).");
                }
                await this.port.close();
                console.log('...closed');
                this.openFlag = false;
                return true;
            } catch (e) {
                console.log('WARNING: Problem closing port -- ' + e);
                return false;
            }
        }
    }

    async write(message) {
        console.log('SEND: ' + message.replace(/[\r\n]/g, '|'));
        try {
            if (this.writer) {
                console.log('UNEXPECTED: Writer already exists');
            }
            this.writer = this.outputStream.getWriter();
            await this.writer.write(message);
        } catch (e) {
            console.log('WARNING: Problem writing data: ' + e);
            throw e;
        } finally { 
            if (this.writer) {
                this.writer.releaseLock();
                this.writer = null;
            }
        }
    }


    async read() {
        console.log('Read... ' + this.buffer.length);
        let reply = null;
        try {
            while (this.buffer.length > 0) {
                if (reply === null) reply = '';
                reply += this.buffer.shift();
            }
        } catch (e) {
            console.log('WARNING: Problem reading serial data: ' + e);
            return null;
        }
        console.log('RECV: ' + (reply === null ? '<null>' : reply.replace(/[\r\n]/g, '|')));
        return reply;
    }


    // Break an existing read
    async cancelRead() {
        return;     // Nothing to do as reading is async
    }


    isBusy() {
// TODO: Should not return early !!!
return false;
        return this.openFlag;
    }

}

