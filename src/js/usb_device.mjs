const encoder = new TextEncoder('windows-1252');
const decoder = new TextDecoder('windows-1252');

const USB_CLASS_COMM = 0x02;        // interface for CDC control
const USB_CLASS_CDC_DATA = 0x0a;    // interface for CDC data

function cdcFromConfiguration(configuration) {
    // Find the control and data interfaces
    let interfaceControl = null;
    let interfaceData = null;
    for (let inter of configuration.interfaces) {
        if (inter.alternates[0].interfaceClass == USB_CLASS_COMM) {
            interfaceControl = inter.interfaceNumber;
        } else if (inter.alternates[0].interfaceClass == USB_CLASS_CDC_DATA) {
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


export default class UsbDevice {


    constructor(device) {
        this.device = device;
        this.type = 'usb';
        this.productName = this.device.productName;
        this.manufacturerName = this.device.manufacturerName;
        this.serialNumber = this.device.serialNumber;
        this.io = null;
    }


    async open() {
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
            throw 'Could not claim interface (could it already be claimed by a driver?): ' + this.io.data.interface + ' -- ' + e;
        }
        console.log('...USB opened');
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
        console.log('SEND: ' + message.replace(/[\r\n]/g, '|'));
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

}

